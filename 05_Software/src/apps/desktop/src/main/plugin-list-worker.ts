import { parentPort, workerData } from "node:worker_threads";
import { PluginStore } from "@vera/core";
import { veraError } from "@vera/shared";

// Main supplies these paths, after current-workbench authorization; package code is never executed.
const { root, workbench } = workerData as { root: string; workbench?: string };
try {
  const plugins = await new PluginStore({ root, ...(workbench ? { workbench } : {}) }).list();
  parentPort?.postMessage({ plugins });
} catch (error) {
  const code = (error as { code?: string }).code;
  parentPort?.postMessage({ error: veraError(code === "DENIED" || code === "INVALID" ? code : "INTERNAL") });
}
