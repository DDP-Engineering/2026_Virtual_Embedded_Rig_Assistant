#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCommand, USAGE, UsageError } from "./args.js";
import { runDocuments } from "./documents.js";
import { ConsoleLogger } from "./host-ports.js";
import { runPluginInstall } from "./plugin.js";
import { reportError, runTurn } from "./run.js";

const logger = new ConsoleLogger((line) => {
  process.stderr.write(line);
});
if (process.env.OPENAI_API_KEY) logger.registerSecret(process.env.OPENAI_API_KEY);
const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  const argv = process.argv.slice(2);
  const loaded = new Map<string, { key?: string; error?: unknown }>();
  // Discover all explicit key-files before strict parser diagnostics, retaining each secret.
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const path = arg === "--key-file" ? argv[++i] : arg.startsWith("--key-file=") ? arg.slice(11) : undefined;
    if (!path) continue;
    try {
      const raw = await readFile(resolve(path), "utf8"),
        key = raw.trim();
      logger.registerSecret(raw);
      logger.registerSecret(key);
      loaded.set(resolve(path), { key });
    } catch (error) {
      loaded.set(resolve(path), { error });
    }
  }
  const options = parseCommand(argv);
  if (!options) process.stdout.write(`${logger.scrub(USAGE)}\n`);
  else if (options.kind === "index" || options.kind === "search")
    process.exitCode = await runDocuments(options, logger, controller.signal);
  else if (options.kind === "plugin-install")
    process.exitCode = await runPluginInstall(options, logger, controller.signal);
  else {
    const credential = options.keyFile ? loaded.get(options.keyFile) : undefined;
    if (credential?.error) throw credential.error;
    const key = options.keyFile ? credential?.key : process.env.OPENAI_API_KEY;
    process.exitCode = await runTurn(options, logger, controller.signal, key);
  }
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${logger.scrub(`vera: ${error.message}\n\n${USAGE}`)}\n`);
    process.exitCode = 2;
  } else {
    reportError(error, logger);
    process.exitCode = 1;
  }
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  await logger.flush();
}
