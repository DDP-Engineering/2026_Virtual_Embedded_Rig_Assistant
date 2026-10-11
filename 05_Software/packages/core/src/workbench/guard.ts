import { createHash } from "node:crypto";
import { createServer } from "node:net";

/** Local IPC coordination, released by the OS on process exit; no filesystem or TCP listener. */
export function guardName(folder: string): string {
  const identity = process.platform === "win32" ? folder.toLowerCase() : folder;
  const hash = createHash("sha256").update(identity).digest("hex");
  return process.platform === "win32" ? `\\\\.\\pipe\\vera-wb-${hash}` : `\0vera-wb-${hash}`;
}
export async function acquireGuard(folder: string): Promise<(() => Promise<void>) | undefined> {
  const server = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(guardName(folder), () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  } catch (error) {
    server.close();
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE")
      return undefined;
    throw error;
  }
  return () =>
    new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
