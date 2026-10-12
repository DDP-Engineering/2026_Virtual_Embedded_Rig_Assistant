import { randomUUID } from "node:crypto";
import { DocumentKnowledge, DocumentsRepository, SettingsService, WorkbenchService } from "@vera/core";
import type { DocumentOptions } from "./args.js";
import { createDocumentServices } from "./document-processor.js";
import { type ConsoleLogger, createNodeFiles, createPaths, nodeClock } from "./host-ports.js";

export async function runDocuments(
  options: DocumentOptions,
  logger: ConsoleLogger,
  signal: AbortSignal,
): Promise<number> {
  const cleanup: (() => Promise<unknown>)[] = [];
  let remove = () => {};
  let failure: unknown;
  let resultCode = 1;
  try {
    signal.throwIfAborted();
    if ([options.workbench, options.query, options.pathGlob].some((v) => v && logger.scrub(v) !== v))
      throw Error("Invalid invocation field.");
    const location = await createPaths(options.data);
    cleanup.push(location.close);
    const files = createNodeFiles(nodeClock),
      settings = new SettingsService({ files, paths: location.paths, uuid: randomUUID, changed: () => {} });
    cleanup.push(() => settings.close());
    await settings.load();
    const documents = createDocumentServices();
    cleanup.push(() => documents.embeddings.dispose());
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
          } catch (e) {
            return (e as NodeJS.ErrnoException).code !== "ESRCH";
          }
        },
        changed: () => {},
      },
      documents.processDocument,
    );
    cleanup.push(() => workbench.close());
    const stop = () => {
      void workbench.close().catch(() => {});
    };
    signal.addEventListener("abort", stop, { once: true });
    remove = () => signal.removeEventListener("abort", stop);
    const snapshot = await workbench.open(options.workbench);
    signal.throwIfAborted();
    if (options.kind === "index") {
      await workbench.reindexDocuments();
      signal.throwIfAborted();
      const rows = new DocumentsRepository(workbench.getDatabase()).list();
      process.stdout.write(`${logger.scrub(JSON.stringify({ documents: rows }))}\n`);
      resultCode = rows.some((r) => r.status === "failed") ? 1 : 0;
    } else {
      const result = await new DocumentKnowledge(
        snapshot.folder,
        workbench.getDatabase(),
        documents.embeddings,
      ).search(
        {
          query: options.query ?? "",
          ...(options.k === undefined ? {} : { k: options.k }),
          ...(options.mode ? { mode: options.mode } : {}),
          ...(options.pathGlob ? { pathGlob: options.pathGlob } : {}),
        },
        signal,
      );
      process.stdout.write(`${logger.scrub(JSON.stringify(result))}\n`);
      resultCode = 0;
    }
  } catch (error) {
    failure = error;
  } finally {
    remove();
    for (const close of cleanup.reverse())
      try {
        await close();
      } catch (e) {
        failure ??= e;
      }
  }
  if (failure) throw failure;
  return resultCode;
}
