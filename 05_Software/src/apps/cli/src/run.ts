import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSystemPrompt,
  ConfiguredWebProvider,
  createCommandShellHost,
  createDownloadPdfExtractor,
  createMaskingResolver,
  createPiAiGateway,
  type LlmGateway,
  leaseRoot,
  ModelCalibrationStore,
  officialPartsPlugin,
  PluginStore,
  type ProgramHost,
  ProgramRunner,
  programPromptEntries,
  ResourceLeases,
  SessionService,
  SettingsService,
  unavailablePartsTools,
  unavailableWebTools,
  WebDownloads,
  WorkbenchService,
} from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import {
  type AdvancedKey,
  customSettingsSchema,
  partsSearchDefaults,
  resolveAdvanced,
  veraError,
  veraErrorSchema,
} from "@vera/shared";
import { flagDecision, promptApproval } from "./approval-prompt.js";
import type { RunOptions } from "./args.js";
import { createDocumentServices } from "./document-processor.js";
import {
  type ConsoleLogger,
  createNodeFiles,
  createPaths,
  MemoryCredentials,
  nodeClock,
} from "./host-ports.js";
import { cliPartsProvider, partsFromEnvironment } from "./parts-env.js";
import { cliProgramCredentials, pluginCredentialsFromEnvironment } from "./plugin-credentials-env.js";
import { createCliProcessHost } from "./process-host.js";
import { createCliProvisioner } from "./provisioning.js";
import { sessionOutput } from "./session-output.js";
import { cliVersion } from "./version.js";
import { createCliWorkerPool } from "./worker-pool.js";

export async function runTurn(
  options: RunOptions,
  logger: ConsoleLogger,
  signal: AbortSignal,
  key?: string,
): Promise<number> {
  const resources: (() => Promise<unknown>)[] = [];
  let off: (() => void) | undefined;
  let failure: unknown;
  let exitCode = 1;
  try {
    signal.throwIfAborted();
    const location = await createPaths(options.data);
    resources.push(location.close);
    const files = createNodeFiles(nodeClock);
    const settings = new SettingsService({
      files,
      paths: location.paths,
      uuid: randomUUID,
      changed: () => {},
    });
    resources.push(() => settings.close());
    await settings.load();
    signal.throwIfAborted();
    const store = new MemoryCredentials((secret) => logger.registerSecret(secret));
    resources.push(() => store.close());
    if (key) logger.registerSecret(key);
    // Reject known-secret user/configuration fields before they can reach durable storage.
    for (const value of [options.prompt, options.workbench, options.model, options.baseUrl, options.session])
      if (value && logger.scrub(value) !== value) throw veraError("INVALID");
    const provider = options.provider === "custom" ? "custom:cli" : options.provider;
    if (key) await store.modify(provider, async () => ({ type: "api_key", key }));
    const config = structuredClone(settings.get().settings);
    for (const [provider, variable] of [
      ["exa", "EXA_API_KEY"],
      ["tavily", "TAVILY_API_KEY"],
      ["brave", "BRAVE_SEARCH_API_KEY"],
    ] as const) {
      const key = process.env[variable];
      if (key) {
        logger.registerSecret(key);
        await store.modify(`web:${provider}`, async () => ({ type: "api_key", key }));
      }
    }
    const web = new ConfiguredWebProvider({
      config: () => config.webAccess,
      getKey: async (provider, signal) => {
        const value = await store.read(`web:${provider}`, { signal });
        return value?.type === "api_key" ? value.key : undefined;
      },
      timeoutMs: () => resolveAdvanced("webTimeout", { app: config.advanced }).value * 1000,
    });
    resources.push(() => web.close());
    // Supplier credentials come only from the environment and stay in memory for this run.
    const partsSettings = await partsFromEnvironment(
      process.env,
      config.partsSearch ?? partsSearchDefaults,
      store,
      (secret) => logger.registerSecret(secret),
    );
    const parts = cliPartsProvider(store, partsSettings, () => config.webAccess.enabled);
    // MQTT broker credentials and Wokwi tokens, also environment-only and in memory: approved runs of the official
    // mqtt-tools and wokwi plugins read them.
    await pluginCredentialsFromEnvironment(process.env, store, (secret) => logger.registerSecret(secret));
    resources.push(() => parts.close());
    let gateway: LlmGateway, model: string;
    if (options.provider === "replay") {
      // Isolate only the explicitly chosen script; unrelated sibling fixtures have no effect.
      const replayLocation = await createPaths();
      resources.push(replayLocation.close);
      const dir = join(replayLocation.paths.userData, "scripts");
      await mkdir(dir);
      // SessionService projects model output after replay interpolation.
      const script = (await readFile(options.script ?? "", "utf8"))
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith("//"))
        .map((line) => JSON.stringify(JSON.parse(line)))
        .join("\n");
      await writeFile(join(dir, "script.jsonl"), script, {
        mode: 0o600,
      });
      gateway = new ReplayGateway({ dir, now: () => nodeClock.now().getTime() });
      await gateway.models("replay", signal);
      model = "replay/script";
    } else {
      if (options.provider === "custom")
        config.providers.custom = [
          customSettingsSchema.parse({
            name: "CLI",
            slug: "cli",
            model: options.model,
            baseUrl: options.baseUrl,
          }),
        ];
      else config.providers.openai.model = options.model;
      gateway = createPiAiGateway({
        settings: () => config,
        credentials: store,
        scrub: (text) => logger.scrub(text),
        knownSecrets: () => logger.knownSecrets(),
        now: () => nodeClock.now().getTime(),
        headerWaitMs: () => resolveAdvanced("headerWait", { app: config.advanced }).value * 1000,
      });
      model = `${provider}/${options.model}`;
    }
    gateway.capabilities(model);
    signal.throwIfAborted();
    const workers = createCliWorkerPool({
      deadlineMs: () => resolveAdvanced("workerDeadline", { app: config.advanced }).value * 1000,
    });
    resources.push(() => workers.dispose());
    const documents = createDocumentServices(() => ({
      extractionMs: resolveAdvanced("extractionTimeout", { app: config.advanced }).value * 1000,
      embeddingIdleMs: resolveAdvanced("embeddingIdle", { app: config.advanced }).value * 1000,
    }));
    resources.push(() => documents.dispose());
    const workbench = new WorkbenchService(
      {
        userData: location.paths.userData,
        files,
        settings,
        pid: process.pid,
        appVersion: cliVersion,
        now: () => nodeClock.now(),
        token: randomUUID,
        isProcessAlive: (pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code !== "ESRCH";
          }
        },
        changed: () => {},
      },
      documents.processDocument,
    );
    resources.push(() => workbench.close());
    // Plugin program runs end with the CLI run: closing resources stops every run's process tree.
    // Bench resources are leased in the per-user folder the desktop app also uses (spec REQ-DATA-f2cbfc23 §5).
    const leases = new ResourceLeases({
      root: leaseRoot({
        platform: process.platform,
        env: process.env,
        tmpdir: tmpdir(),
        uid: process.getuid?.(),
      }),
      app: "cli",
    });
    const processHost = createCliProcessHost();
    const app = <K extends AdvancedKey>(key: K) => resolveAdvanced(key, { app: config.advanced }).value;
    const programs = new ProgramRunner({
      host: processHost,
      clock: nodeClock,
      leases,
      limits: () => ({
        maxBackground: app("backgroundPrograms"),
        logsKept: app("runLogsKept"),
        logBytes: app("runLogMB") * 1024 * 1024,
      }),
    });
    resources.push(() => programs.stopAll());
    const snapshot = await workbench.open(options.workbench);
    signal.throwIfAborted();
    const db = workbench.getDatabase(),
      pinned = (await workbench.getPinned()).content;
    const skills = workbench.skillCatalog(snapshot.config.id);
    const skillList = await skills.list();
    const skillMetadata = skillList
      .filter((skill) => skill.enabled && !skill.error)
      .map(({ name, description }) => ({ name, description }));
    // Programs resolve through provisioning; a run never installs one (vera plugin install does).
    const programHost: ProgramHost = {
      runner: programs,
      shell: createCommandShellHost(
        processHost,
        () => settings.get().settings.shell,
        (text) => logger.scrub(text),
      ),
      clock: nodeClock,
      resolver: createCliProvisioner(
        new PluginStore({ root: join(location.paths.userData, "plugins"), workbench: snapshot.folder }),
        location.paths.userData,
        () => config.plugins,
      ),
      plugins: () => workbench.loadPlugins(snapshot.config.id),
      credentials: cliProgramCredentials(store),
    };
    const programEntries = await programPromptEntries(programHost, skillList);
    const partsPlugin = (await workbench.loadPlugins(snapshot.config.id)).some(officialPartsPlugin);
    const service = new SessionService({
      db,
      root: snapshot.folder,
      readOnly: snapshot.readOnly,
      gateway,
      ...(options.provider !== "replay" && {
        modelCalibrations: new ModelCalibrationStore(
          location.paths.userData,
          files,
          () => config.providers.custom,
        ),
      }),
      web,
      parts: {
        search: (args, signal) =>
          parts.search(args, signal, async () =>
            (await workbench.loadPlugins(snapshot.config.id)).some(officialPartsPlugin),
          ),
      },
      downloads: new WebDownloads(snapshot.folder, {
        access: web,
        pdf: createDownloadPdfExtractor(new URL("./pdf-worker.js", import.meta.url)),
      }),
      clock: nodeClock,
      workers,
      skills,
      programs: programHost,
      commandPrefixes: () => workbench.getSnapshot().config.agent.allowed_commands,
      pluginBuilder: new PluginStore({ root: join(location.paths.userData, "plugins") }),
      managedRoots: [location.paths.userData],
      additionalFolders: () => workbench.getSnapshot().config.additional_folders,
      get embeddings() {
        return documents.embeddings(snapshot.config.embeddings.model);
      },
      writeQueue: workbench.getWriteQueue(),
      mode: snapshot.config.agent.permission_mode,
      retrieval: snapshot.config.retrieval,
      documentIndexPhase: () => workbench.documentIndexPhase(snapshot.config.id, db),
      disabledTools: [
        ...snapshot.config.tools.disabled,
        ...unavailableWebTools(config.webAccess),
        ...unavailablePartsTools(config.webAccess.enabled, partsSettings, partsPlugin),
      ],
      // --advanced values apply to this run only and are not recorded in the session (REQ-FUNC-181db660).
      advanced: {
        app: () => config.advanced,
        workbench: () => workbench.getSnapshot().config.advanced,
        run: () => options.advanced,
      },
      model: () => model,
      assertWritable: () => workbench.assertSessionWritable(),
      scrub: (text) => logger.scrub(text),
      log: (message) => logger.log("error", message),
      knownSecrets: () => logger.knownSecrets(),
      masking: (area) =>
        createMaskingResolver(() => settings.get().settings)(workbench.getSnapshot().config, area),
      prompt: (mode) =>
        buildSystemPrompt({
          workbench: snapshot.config,
          pinned,
          skills: skillMetadata,
          programs: programEntries,
          commands: !(snapshot.config.tools.disabled ?? []).includes("run_command"),
          env: {
            clock: nodeClock,
            osFamily: process.platform === "win32" ? "windows" : "linux",
            veraVersion: cliVersion,
            permissionMode: mode,
            indexedDocuments: (
              db.prepare("SELECT count(*) AS n FROM documents WHERE status='indexed'").get() as { n: number }
            ).n,
          },
        }).text,
    });
    resources.push(() => service.close());
    await service.waitReady();
    const id = options.session ?? service.create(model).id;
    const since = options.session ? service.get(id).seq : 0;
    if (options.session) service.setModel(id, model);
    off = service.subscribe(id, since, (seq, event) => {
      const record = {
        sessionId: id,
        ...(seq === undefined ? {} : { seq }),
        event: sessionOutput(
          event,
          (text) => service.maskContent("agent", text),
          (text) => logger.scrub(text),
        ),
      };
      const line =
        options.format === "jsonl" ? JSON.stringify(record) : `${id} ${event.type} ${JSON.stringify(record)}`;
      process.stdout.write(`${line}\n`);
      if (event.type === "approval.requested")
        void Promise.resolve()
          .then(async () => {
            // Automatic mode may have decided synchronously after emitting requested.
            if (
              service.get(id).snapshot.approvals.find((a) => a.approvalId === event.approvalId)?.decision !==
              null
            )
              return;
            const flagged = flagDecision(
              event,
              options.approve,
              !!(process.stdin.isTTY && process.stderr.isTTY),
            );
            const { decision, confirmation } = flagged
              ? { decision: flagged, confirmation: undefined }
              : await promptApproval(event, signal, process.stdin, process.stderr, (text) =>
                  logger.scrub(text),
                );
            if (decision !== "aborted")
              service.decideApproval({
                sessionId: id,
                approvalId: event.approvalId,
                requestSha256: event.requestSha256,
                decision,
                ...(confirmation === undefined ? {} : { confirmation }),
              });
          })
          .catch((error) => {
            if (veraErrorSchema.safeParse(error).data?.code !== "CONFLICT") {
              failure ??= error;
              service.stop(id);
            }
          });
    });
    const stop = () => {
      try {
        service.stop(id);
      } catch {
        void service.close();
      }
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      signal.throwIfAborted();
      service.send(id, options.prompt);
      const result = await service.waitIdle(id);
      exitCode = result?.stopReason === "end" ? 0 : 1;
    } finally {
      signal.removeEventListener("abort", stop);
    }
  } catch (error) {
    failure = error;
  } finally {
    off?.();
    for (const close of resources.reverse()) {
      try {
        await close();
      } catch (error) {
        failure ??= error;
      }
    }
  }
  if (failure) throw failure;
  return exitCode;
}
export function reportError(error: unknown, logger: ConsoleLogger): void {
  const parsed = veraErrorSchema.safeParse(error);
  const safe = parsed.success ? parsed.data : veraError("INTERNAL");
  process.stderr.write(
    `${logger.scrub(JSON.stringify({ event: { type: "error", ...safe, retryable: false } }))}\n`,
  );
  logger.log("error", safe.messageKey, safe.params);
}
