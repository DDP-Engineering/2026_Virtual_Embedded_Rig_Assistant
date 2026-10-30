import {
  buildSystemPrompt,
  type Clock,
  type EmbeddingPort,
  ExaWebProvider,
  type PermissionEngine,
  SessionService,
  type SettingsService,
  type SkillCatalog,
  type WorkbenchService,
  type WorkerPool,
} from "@vera/core";
import {
  type EventEnvelope,
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
  private readonly subscriptions = new Map<string, () => void>();
  private queue = Promise.resolve();
  private pending = 0;
  private shutdown = false;
  constructor(
    private readonly options: {
      workbench: WorkbenchService;
      settings: SettingsService;
      gateway: () => ProviderGateway;
      credentials: CredentialFile;
      clock: Clock;
      workers: WorkerPool;
      embeddings?: EmbeddingPort;
      version: string;
      target: () => RendererTarget | undefined;
      emit: (event: EventEnvelope) => unknown;
      permissions?: PermissionEngine;
    },
  ) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  run<T>(operation: (service: SessionService) => T | Promise<T>): Promise<T> {
    if (this.shutdown) return Promise.reject(veraError("BUSY"));
    this.pending++;
    return this.serial(async () => {
      const snapshot = this.options.workbench.getSnapshot();
      const db = this.options.workbench.getDatabase();
      this.config = (await this.options.workbench.getConfig()).config;
      this.pinned = (await this.options.workbench.getPinned()).content;
      this.skills = this.options.workbench.skillCatalog(snapshot.config.id);
      this.skillMetadata = await this.skills.metadata();
      if (this.db !== db) {
        await this.drain();
        const options = this.options;
        const self = this;
        this.service = new SessionService({
          db,
          root: snapshot.folder,
          readOnly: snapshot.readOnly,
          get mode() {
            return self.config?.agent.permission_mode ?? "ask";
          },
          gateway: options.gateway().api,
          web: new ExaWebProvider(),
          clock: options.clock,
          workers: options.workers,
          get skills() {
            return self.skills;
          },
          ...(options.embeddings ? { embeddings: options.embeddings } : {}),
          writeQueue: options.workbench.getWriteQueue(),
          ...(options.permissions ? { permissions: options.permissions } : {}),
          get maxToolCallsPerTurn() {
            return options.settings.get().settings.limits.maxToolCallsPerTurn;
          },
          get disabledTools() {
            return self.config?.tools.disabled ?? [];
          },
          model: (ref) => options.gateway().modelReference(ref, this.config?.agent.model),
          prompt: (mode) =>
            buildSystemPrompt({
              workbench: this.config ?? snapshot.config,
              pinned: this.pinned,
              skills: this.skillMetadata,
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
        });
        this.db = db;
      }
      if (!this.service) throw veraError("INTERNAL");
      await this.service.waitReady();
      return operation(this.service);
    }).finally(() => {
      this.pending--;
    });
  }
  async lifecycle<T>(operation: () => Promise<T>): Promise<T> {
    if (this.shutdown) throw veraError("BUSY");
    this.pending++;
    return this.serial(async () => {
      await this.drain();
      return operation();
    }).finally(() => {
      this.pending--;
    });
  }
  /** Synchronous check-and-lock: accepted queued sends cannot race a safe update quit. */
  beginShutdown(): boolean {
    if (this.pending || this.service?.hasActiveWork()) return false;
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
