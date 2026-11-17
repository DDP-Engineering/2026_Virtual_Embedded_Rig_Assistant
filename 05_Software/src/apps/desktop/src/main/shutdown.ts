export type ShutdownStep = readonly [name: string, run: () => unknown];

/**
 * Runs the concurrent steps together, then the ordered steps one by one. A failed step is reported
 * and never skips the steps after it, so pending writes are still persisted; resolves to whether
 * every step succeeded.
 */
export async function drainShutdown(
  concurrent: readonly ShutdownStep[],
  ordered: readonly ShutdownStep[],
  failed: (step: string) => void,
): Promise<boolean> {
  let clean = true;
  const run = async ([name, step]: ShutdownStep) => {
    try {
      await step();
    } catch {
      clean = false;
      failed(name);
    }
  };
  await Promise.all(concurrent.map(run));
  for (const step of ordered) await run(step);
  return clean;
}
