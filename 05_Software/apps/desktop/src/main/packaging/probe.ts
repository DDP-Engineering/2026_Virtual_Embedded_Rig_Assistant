import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { Worker } from "node:worker_threads";
import { app } from "electron";
import { probeSqlite } from "./sqlite-probe.js";

async function probeEmbeddings() {
  const worker = new Worker(new URL("./embedding-worker.js", import.meta.url), {
    workerData: {
      models: join(process.resourcesPath, "models"),
      sentences: [
        "The I2C1_CR1 register enables the peripheral clock.",
        "Pull-up resistors connect SDA and SCL to the supply rail.",
        "The watchdog resets the embedded processor after a timeout.",
      ],
    },
  });
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Embedding worker timed out")), 300_000);
      worker.once("message", (message) => {
        clearTimeout(timeout);
        if (message?.ok && message.result?.status === "passed" && message.result?.chunks?.length === 3) {
          resolve(message.result);
        } else reject(new Error(message?.error ?? "Invalid embedding worker result"));
      });
      worker.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      worker.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Embedding worker exited before result (${code})`));
      });
    });
  } finally {
    await worker.terminate();
  }
}

export async function runPackagingProbe(output: string): Promise<number> {
  if (!app.isPackaged || !isAbsolute(output))
    throw new Error("Packaging probe requires a packaged app and absolute output path");
  const report: Record<string, unknown> = {
    schema: 1,
    timestamp: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
    packaged: app.isPackaged,
    resources: process.resourcesPath,
  };
  let status = 0;
  for (const [name, run] of [
    ["sqlite", probeSqlite],
    ["embeddings", probeEmbeddings],
  ] as const) {
    try {
      const result = await run();
      report[name] = result;
      if (
        name === "sqlite" &&
        (result as Awaited<ReturnType<typeof probeSqlite>>).primary.status !== "passed"
      )
        status = 1;
    } catch (error) {
      report[name] = { status: "failed", error: String(error) };
      status = 1;
    }
  }
  report.status = status === 0 ? "passed" : "failed";
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return status;
}
