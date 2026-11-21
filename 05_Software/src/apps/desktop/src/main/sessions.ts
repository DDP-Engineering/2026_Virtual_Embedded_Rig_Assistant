import {
  buildSystemPrompt,
  type Clock,
  type ConfiguredPartsProvider,
  createMaskingResolver,
  type EmbeddingPort,
  electricalModelPlugin,
  type HelpLibrary,
  officialLayoutPlugin,
  officialPartsPlugin,
  type PermissionEngine,
  type PluginStore,
  type ProgramCredentials,
  type ProgramHost,
  type ProgramPromptEntry,
  type ProgramResolver,
  type ProgramRunner,
  programPromptEntries,
  SessionService,
  type SettingsService,
  type SkillCatalog,
  type TerminalReader,
  unavailablePartsTools,
  unavailableWebTools,
  type WebDownloads,
  type WebProvider,
  type WorkbenchService,
  type WorkerPool,
} from "@vera/core";
import {
  type EmbeddingModelId,
  type EventEnvelope,
  type HelpLanguage,
  partsSearchDefaults,
  sessionSubscriptionSchema,
  sessionUnsubscriptionSchema,
  veraError,
  veraErrorSchema,
  type WorkbenchConfig,
} from "@vera/shared";
import type { CredentialFile } from "./credentials.js";
import { authorizedSender, type InvokeSender, type RendererTarget } from "./ipc-router.js";
import type { ProviderGateway } from "./provider-gateway.js";
import { createSessionTransport } from "./session-events.js";

export class SessionsHost {
  private service: SessionService | undefined;
  private db: ReturnType<WorkbenchService["getDatabase"]> | undefined;
  private config: WorkbenchConfig | undefined;
  private pinned = "";
  private skills: SkillCatalog | undefined;
  private skillMetadata: { name: string; description: string }[] = [];
  private programHost: ProgramHost | undefined;
  private programEntries: ProgramPromptEntry[] = [];
  /** The prompt entries are reused until this key changes: workbench, generation and plugin skills. */
  private programKey = "";
  private programGeneration = 0;
  /** Whether the open workbench has the official parts-search plugin loaded; refreshed by run(). */
  private partsPlugin = false;
  /** Whether the open workbench has the official kicad-layout plugin loaded (apply_candidate); refreshed by run(). */
  private layoutPlugin = false;
  /** Whether a loaded plugin builds on the electrical model (electrical, automation); refreshed by run(). */
  private electricalPlugins: readonly string[] = [];
  private readonly subscriptions = new Map<string, () => void>();
  private queue = Promise.resolve();
  private pending = 0;
  private shutdown = false;
  constructor(
    private readonly options: {
      workbench: WorkbenchService;
      terminals?: (workbenchId: string) => TerminalReader;
      settings: SettingsService;
      gateway: () => ProviderGateway;
      credentials: CredentialFile;
      log?: (message: string) => void;
      clock: Clock;
      workers: WorkerPool;
      embeddings?: (model: EmbeddingModelId) => EmbeddingPort;
      version: string;
      target: () => RendererTarget | undefined;
      emit: (event: EventEnvelope) => unknown;
      permissions?: PermissionEngine;
      web?: WebProvider;
      /** Supplier catalog search; offered only with the official parts-search plugin of the workbench. */
      parts?: ConfiguredPartsProvider;
      downloads?: (root: string) => WebDownloads;
      /** Plugin program runs; each workbench supplies its enabled plugins. */
      programs?: {
        runner: ProgramRunner;
        resolver: ProgramResolver;
        credentials?: ProgramCredentials;
        shell?: ProgramHost["shell"];
      };
      pluginBuilder?: PluginStore;
      managedRoots?: readonly string[];
      /** VERA's help for the agent's help tool: the app help and the interface language. */
      help?: { app: HelpLibrary; language: () => HelpLanguage };
      /** Owned work may have settled: a turn or compaction ended, or the queued operations ran out (see idle()). */
      settled?: () => void;
    },
  ) {}
  /** One queued operation finished; the last one may leave the host idle. */
  private finished(): void {
    this.pending--;
    if (this.pending) return;
    try {
      this.options.settled?.();
    } catch {
      /* an observer never fails the operation that finished */
    }
  }
  /** No queued operation, active turn, undecided approval or compaction: the workbench may be released. */
  idle(): boolean {
    return !this.pending && (this.service?.isSettled() ?? true);
  }
  /** Work a safe update waits for: a queued operation, an active turn or an undecided approval. */
  busy(): boolean {
    return this.pending > 0 || !!this.service?.hasActiveWork();
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  run<T>(operation: (service: SessionService) => T | Promise<T>, preparePrograms = true): Promise<T> {
    if (this.shutdown) return Promise.reject(veraError("BUSY"));
    this.pending++;
    return this.serial(async () => {
      const snapshot = this.options.workbench.getSnapshot();
      const db = this.options.workbench.getDatabase();
      this.config = preparePrograms ? (await this.options.workbench.getConfig()).config : snapshot.config;
      if (preparePrograms) {
        this.pinned = (await this.options.workbench.getPinned()).content;
        this.skills = this.options.workbench.skillCatalog(snapshot.config.id);
        const skills = await this.skills.list();
        this.skillMetadata = skills
          .filter((skill) => skill.enabled && !skill.error)
          .map(({ name, description }) => ({ name, description }));
        const programs = this.options.programs;
        this.programHost = programs && {
          ...programs,
          clock: this.options.clock,
          plugins: () => this.options.workbench.loadPlugins(snapshot.config.id),
        };
        // Resolving loads and hashes every enabled plugin and may probe programs: reuse the entries
        // until a plugin changes (invalidatePrograms) or the workbench or its plugin skills do.
        const loaded =
          this.programHost || this.options.parts
            ? await this.options.workbench.loadPlugins(snapshot.config.id)
            : [];
        this.partsPlugin = loaded.some(officialPartsPlugin);
        this.layoutPlugin = loaded.some(officialLayoutPlugin);
        this.electricalPlugins = loaded.filter(electricalModelPlugin).map((plugin) => plugin.manifest.id);
        const key = JSON.stringify([
          snapshot.folder,
          snapshot.config.id,
          (this.programHost ? loaded : []).map((plugin) => [plugin.manifest.id, plugin.record.sha256]),
          this.programGeneration,
          skills
            .filter((skill) => skill.source === "plugin")
            .map((skill) => [skill.plugin, skill.name, skill.enabled, Boolean(skill.error)]),
        ]);
        if (key !== this.programKey) {
          this.programEntries = this.programHost ? await programPromptEntries(this.programHost, skills) : [];
          this.programKey = key;
        }
      }
      if (!this.programHost && this.options.programs)
        this.programHost = {
          ...this.options.programs,
          clock: this.options.clock,
          plugins: () => this.options.workbench.loadPlugins(snapshot.config.id),
        };
      if (this.db !== db) {
        await this.drain();
        const options = this.options;
        this.programHost = options.programs && {
          ...options.programs,
          clock: options.clock,
          plugins: () => options.workbench.loadPlugins(snapshot.config.id),
        };
        const self = this;
        const partsProvider = options.parts;
        const workbenchId = snapshot.config.id;
        this.service = new SessionService({
          db,
          root: snapshot.folder,
          ...(options.settled ? { onWorkSettled: options.settled } : {}),
          onDelegationsChanged: () =>
            options.emit({
              topic: "workbench",
              id: workbenchId,
              event: { type: "session.delegations.changed" },
            }),
          ...(options.terminals ? { terminals: options.terminals(workbenchId) } : {}),
          readOnly: snapshot.readOnly,
          additionalFolders: () => {
            const current = options.workbench.getSnapshot();
            if (current.config.id !== workbenchId) throw veraError("CONFLICT");
            return current.config.additional_folders;
          },
          commandPrefixes: () => {
            const current = options.workbench.getSnapshot();
            if (current.config.id !== workbenchId) throw veraError("CONFLICT");
            return current.config.agent.allowed_commands;
          },
          saveCommandPrefix: async (prefix) => {
            await options.workbench.allowCommandPrefix(prefix, workbenchId);
          },
          get mode() {
            return self.config?.agent.permission_mode ?? "ask";
          },
          gateway: options.gateway().api,
          ...(options.web ? { web: options.web } : {}),
          ...(partsProvider
            ? {
                parts: {
                  search: (args: unknown, signal: AbortSignal) =>
                    partsProvider.search(args, signal, async () =>
                      (await options.workbench.loadPlugins(workbenchId)).some(officialPartsPlugin),
                    ),
                },
              }
            : {}),
          ...(options.downloads ? { downloads: options.downloads(snapshot.folder) } : {}),
          ...(options.help
            ? {
                help: {
                  ...options.help,
                  // Only the workbench's enabled plugins, whose packages loaded without issues (REQ-SEC-3cb78ea6).
                  plugins: async () =>
                    (await options.workbench.loadPlugins(workbenchId)).map((plugin) => ({
                      id: plugin.manifest.id,
                      folder: plugin.folder,
                    })),
                },
              }
            : {}),
          get applyCandidate() {
            return self.layoutPlugin;
          },
          get electricalPlugins() {
            return self.electricalPlugins;
          },
          ...(options.pluginBuilder ? { pluginBuilder: options.pluginBuilder } : {}),
          ...(options.managedRoots ? { managedRoots: options.managedRoots } : {}),
          clock: options.clock,
          workers: options.workers,
          get skills() {
            return self.skills;
          },
          get embeddings() {
            return options.embeddings?.((self.config ?? snapshot.config).embeddings.model);
          },
          get retrieval() {
            return self.config?.retrieval;
          },
          writeQueue: options.workbench.getWriteQueue(),
          ...(options.permissions ? { permissions: options.permissions } : {}),
          ...(this.programHost ? { programs: this.programHost } : {}),
          // Read at each turn, so saved Advanced values apply from the next turn (REQ-FUNC-902313e0).
          advanced: {
            app: () => options.settings.get().settings.advanced,
            workbench: () => options.workbench.getSnapshot().config.advanced,
          },
          get disabledTools() {
            return [
              ...(self.config?.tools.disabled ?? []),
              ...unavailableWebTools(options.settings.get().settings.webAccess),
              ...unavailablePartsTools(
                options.settings.get().settings.webAccess.enabled,
                options.settings.get().settings.partsSearch ?? partsSearchDefaults,
                self.partsPlugin,
              ),
            ];
          },
          model: (ref) => options.gateway().modelReference(ref, this.config?.agent.model),
          prompt: (mode) =>
            buildSystemPrompt({
              workbench: this.config ?? snapshot.config,
              pinned: this.pinned,
              skills: this.skillMetadata,
              programs: this.programEntries,
              commands:
                !!this.programHost?.shell && !(this.config?.tools.disabled ?? []).includes("run_command"),
              // The rule names the tool only while the workbench offers it (REQ-FUNC-4fa3e396).
              help: !!options.help && !(this.config?.tools.disabled ?? []).includes("help"),
              env: {
                clock: options.clock,
                osFamily: process.platform === "win32" ? "windows" : "linux",
                veraVersion: options.version,
                permissionMode: mode,
                indexedDocuments: (
                  db.prepare("SELECT count(*) AS n FROM documents WHERE status='indexed'").get() as {
                    n: number;
                  }
                ).n,
              },
            }).text,
          assertWritable: () => options.workbench.assertSessionWritable(),
          scrub: (text) => options.credentials.scrub(text),
          ...(options.log ? { log: options.log } : {}),
          knownSecrets: () => options.credentials.knownSecrets(),
          masking: (area) => {
            const current = options.workbench.getSnapshot();
            if (current.config.id !== workbenchId) throw veraError("CONFLICT");
            return createMaskingResolver(() => options.settings.get().settings)(current.config, area);
          },
        });
        this.db = db;
      }
      if (!this.service) throw veraError("INTERNAL");
      await this.service.waitReady();
      return operation(this.service);
    }).finally(() => this.finished());
  }
  /** Resolve the session's model on the host queue. Catalog I/O may outlive this queue slot. */
  async imageCapability(workbenchId: string, sessionId: string) {
    const { completion } = await this.run((service) => {
      if (this.options.workbench.getSnapshot().config.id !== workbenchId) throw veraError("CONFLICT");
      return { completion: service.imageCapability(sessionId) };
    }, false);
    return completion;
  }
  /** Polling only needs recovered current-DB summaries, never prompt/skill/program preparation. */
  async list(workbenchId?: string) {
    if (this.shutdown) throw veraError("BUSY");
    const snapshot = this.options.workbench.getSnapshot(),
      db = this.options.workbench.getDatabase();
    if (workbenchId && snapshot.config.id !== workbenchId) throw veraError("CONFLICT");
    const service = this.service;
    let rows: ReturnType<SessionService["list"]>;
    if (service && this.db === db) {
      await service.waitReady();
      if (this.shutdown) throw veraError("BUSY");
      if (
        this.service !== service ||
        this.options.workbench.getDatabase() !== db ||
        this.options.workbench.getSnapshot().config.id !== snapshot.config.id
      )
        throw veraError("CONFLICT");
      rows = service.list(true);
    } else {
      rows = await this.run((current) => {
        if (
          this.options.workbench.getDatabase() !== db ||
          this.options.workbench.getSnapshot().config.id !== snapshot.config.id
        )
          throw veraError("CONFLICT");
        return current.list(true);
      }, false);
    }
    return rows.map((row) => ({ ...row, title: this.service?.maskContent("agent", row.title) ?? row.title }));
  }
  /** Recomputes the program prompt entries on the next session call: a plugin was installed, removed, toggled or provisioned. */
  invalidatePrograms(): void {
    this.programGeneration++;
  }
  /**
   * Runs a workbench lifecycle change between queued session operations. `drain` first closes the
   * session service, ending its turns; a reopen in place passes false and keeps it, unless the reopen
   * replaced the database (a read-only snapshot is copied again), whose closed handle the service held.
   */
  async lifecycle<T>(operation: () => Promise<T>, drain = true): Promise<T> {
    if (this.shutdown) throw veraError("BUSY");
    this.pending++;
    return this.serial(async () => {
      if (drain) await this.drain();
      try {
        return await operation();
      } finally {
        if (this.db && !this.db.open) await this.drain();
      }
    }).finally(() => this.finished());
  }
  /** Synchronous check-and-lock: accepted queued sends cannot race a safe update quit. */
  beginShutdown(): boolean {
    if (this.busy()) return false;
    this.shutdown = true;
    return true;
  }
  private async drain(): Promise<void> {
    this.clearSubscriptions();
    await this.service?.close();
    this.service = undefined;
    this.db = undefined;
  }
  clearSubscriptions(): void {
    for (const off of this.subscriptions.values()) off();
    this.subscriptions.clear();
  }
  async close(): Promise<void> {
    await this.serial(() => this.drain());
  }
  async subscription(event: InvokeSender, action: unknown, raw: unknown) {
    if (!authorizedSender(event, this.options.target())) return { ok: false, error: veraError("DENIED") };
    const parsed =
      action === "subscribe"
        ? sessionSubscriptionSchema.safeParse(raw)
        : action === "unsubscribe"
          ? sessionUnsubscriptionSchema.safeParse(raw)
          : undefined;
    if (!parsed?.success) return { ok: false, error: veraError("INVALID") };
    try {
      if (action === "unsubscribe")
        await this.serial(async () => {
          this.subscriptions.get(parsed.data.subscriptionId)?.();
          this.subscriptions.delete(parsed.data.subscriptionId);
        });
      else {
        const request = sessionSubscriptionSchema.parse(raw);
        await this.run((service) => {
          if (!authorizedSender(event, this.options.target())) throw veraError("DENIED");
          if (this.subscriptions.has(request.subscriptionId)) throw veraError("CONFLICT");
          if (this.subscriptions.size >= 128) throw veraError("BUSY");
          const transport = createSessionTransport(request.sessionId, request.subscriptionId, (e) =>
            this.options.emit(e),
          );
          const off = service.subscribe(request.sessionId, request.sinceSeq, transport.on);
          this.subscriptions.set(request.subscriptionId, () => {
            off();
            transport.dispose();
          });
        });
      }
      return { ok: true, value: {} };
    } catch (error) {
      const known = veraErrorSchema.safeParse(error);
      return { ok: false, error: known.success ? known.data : veraError("INTERNAL") };
    }
  }
}
