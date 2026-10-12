import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildSystemPrompt,
  createPiAiGateway,
  type LlmGateway,
  SessionService,
  SettingsService,
  WorkbenchService,
} from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import { customSettingsSchema, veraError, veraErrorSchema } from "@vera/shared";
import { promptApproval } from "./approval-prompt.js";
import type { RunOptions } from "./args.js";
import { createDocumentServices } from "./document-processor.js";
import {
  type ConsoleLogger,
  createNodeFiles,
  createPaths,
  MemoryCredentials,
  nodeClock,
} from "./host-ports.js";
import { scrubReplayOutput } from "./replay-output.js";
import { createCliWorkerPool } from "./worker-pool.js";

export async function runTurn(
  options: RunOptions,
  logger: ConsoleLogger,
  signal: AbortSignal,
  key: string | undefined = process.env.OPENAI_API_KEY,
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
    let gateway: LlmGateway, model: string;
    if (options.provider === "replay") {
      // Isolate only the explicitly chosen script; unrelated sibling fixtures have no effect.
      const replayLocation = await createPaths();
      resources.push(replayLocation.close);
      const dir = join(replayLocation.paths.userData, "scripts");
      await mkdir(dir);
      // Decode all JSON escapes before scrubbing; core retains validation and replay semantics.
      const script = (await readFile(options.script ?? "", "utf8"))
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith("//"))
        .map((line) => logger.scrub(JSON.stringify(JSON.parse(line))))
        .join("\n");
      await writeFile(join(dir, "script.jsonl"), script, {
        mode: 0o600,
      });
      gateway = scrubReplayOutput(new ReplayGateway({ dir, now: () => nodeClock.now().getTime() }), (text) =>
        logger.scrub(text),
      );
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
      });
      model = `${provider}/${options.model}`;
    }
    gateway.capabilities(model);
    signal.throwIfAborted();
    const workers = createCliWorkerPool();
    resources.push(() => workers.dispose());
    const documents = createDocumentServices();
    resources.push(() => documents.embeddings.dispose());
    const workbench = new WorkbenchService(
      {
        files,
        settings,
        pid: process.pid,
        appVersion: "0.0.0",
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
    const snapshot = await workbench.open(options.workbench);
    signal.throwIfAborted();
    const db = workbench.getDatabase(),
      pinned = (await workbench.getPinned()).content;
    const service = new SessionService({
      db,
      root: snapshot.folder,
      readOnly: snapshot.readOnly,
      gateway,
      clock: nodeClock,
      workers,
      embeddings: documents.embeddings,
      writeQueue: workbench.getWriteQueue(),
      mode: snapshot.config.agent.permission_mode,
      disabledTools: snapshot.config.tools.disabled,
      maxToolCallsPerTurn: config.limits.maxToolCallsPerTurn,
      model: () => model,
      assertWritable: () => workbench.assertSessionWritable(),
      scrub: (text) => logger.scrub(text),
      prompt: (mode) =>
        buildSystemPrompt({
          workbench: snapshot.config,
          pinned,
          skills: [],
          env: {
            clock: nodeClock,
            osFamily: process.platform === "win32" ? "windows" : "linux",
            veraVersion: "0.0.0",
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
      const record = { sessionId: id, ...(seq === undefined ? {} : { seq }), event };
      const line =
        options.format === "jsonl" ? JSON.stringify(record) : `${id} ${event.type} ${JSON.stringify(record)}`;
      process.stdout.write(`${logger.scrub(line)}\n`);
      if (event.type === "approval.requested")
        void Promise.resolve()
          .then(async () => {
            // Automatic mode may have decided synchronously after emitting requested.
            if (
              service.get(id).snapshot.approvals.find((a) => a.approvalId === event.approvalId)?.decision !==
              null
            )
              return;
            const decision =
              options.approve === "all"
                ? "approved"
                : options.approve === "none"
                  ? "denied"
                  : process.stdin.isTTY && process.stderr.isTTY
                    ? await promptApproval(event, signal, process.stdin, process.stderr, (text) =>
                        logger.scrub(text),
                      )
                    : "denied";
            if (decision !== "aborted")
              service.decideApproval({
                sessionId: id,
                approvalId: event.approvalId,
                requestSha256: event.requestSha256,
                decision,
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
