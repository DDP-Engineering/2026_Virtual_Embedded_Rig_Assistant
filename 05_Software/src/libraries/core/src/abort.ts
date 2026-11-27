import { addAbortListener } from "node:events";

/** Stop waiting for host I/O even if the current operation cannot be interrupted by its port. */
export async function waitForAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  let listener: ReturnType<typeof addAbortListener> | undefined;
  try {
    const value = await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else listener = addAbortListener(signal, () => reject(signal.reason));
      }),
    ]);
    signal.throwIfAborted();
    return value;
  } finally {
    listener?.[Symbol.dispose]();
  }
}
