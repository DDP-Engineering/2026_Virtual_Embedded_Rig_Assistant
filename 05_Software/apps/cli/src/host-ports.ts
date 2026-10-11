import { randomUUID } from "node:crypto";
import { type FileHandle, mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  type AuthOperationOptions,
  type Clock,
  type Credential,
  type CredentialStore,
  type CredentialWriteOptions,
  type FileAccess,
  type Logger,
  type PathProvider,
  scrub,
} from "@vera/core";

export const nodeClock: Clock = {
  now: () => new Date(),
  sleep: async (ms) => {
    await setTimeout(ms);
  },
};
export class ConsoleLogger implements Logger {
  private readonly secrets = new Set<string>();
  constructor(private readonly write: (line: string) => void) {}
  registerSecret(secret: string): () => void {
    if (secret) this.secrets.add(secret);
    return () => {};
  }
  knownSecrets(): string[] {
    return [...this.secrets];
  }
  scrub(text: string): string {
    return scrub(text, this.secrets);
  }
  log(level: Parameters<Logger["log"]>[0], message: string, data?: unknown): void {
    this.write(
      `${this.scrub(JSON.stringify({ level, message, ...(data === undefined ? {} : { data }) }))}\n`,
    );
  }
  async flush(): Promise<void> {}
}
export class MemoryCredentials implements CredentialStore {
  private readonly values = new Map<string, Credential>();
  private queue = Promise.resolve();
  constructor(private readonly register: (secret: string) => unknown) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  async read(id: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    await this.queue;
    options?.signal?.throwIfAborted();
    const value = this.values.get(id);
    return value ? structuredClone(value) : undefined;
  }
  async list(options?: AuthOperationOptions) {
    await this.queue;
    options?.signal?.throwIfAborted();
    return [...this.values].map(([providerId, value]) => ({ providerId, type: value.type }));
  }
  modify(
    id: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: CredentialWriteOptions,
  ): Promise<Credential | undefined> {
    return this.serial(async () => {
      options?.signal?.throwIfAborted();
      const previous = this.values.get(id);
      const value = await fn(previous ? structuredClone(previous) : undefined);
      options?.signal?.throwIfAborted();
      if (value) {
        if (value.type === "api_key") {
          if (value.key) this.register(value.key);
          for (const text of Object.values(value.env ?? {})) this.register(text);
        } else {
          this.register(value.access);
          this.register(value.refresh);
        }
        this.values.set(id, structuredClone(value));
      }
      const result = value ?? previous;
      return result ? structuredClone(result) : undefined;
    });
  }
  delete(id: string, options?: AuthOperationOptions): Promise<void> {
    return this.serial(async () => {
      options?.signal?.throwIfAborted();
      this.values.delete(id);
    });
  }
  async close(): Promise<void> {
    await this.queue;
    this.values.clear();
  }
}
export async function createPaths(data?: string): Promise<{ paths: PathProvider; close(): Promise<void> }> {
  const userData = data ?? (await mkdtemp(join(tmpdir(), "vera-cli-data-")));
  await mkdir(userData, { recursive: true });
  return {
    paths: { userData, settings: join(userData, "settings.json"), logs: join(userData, "logs") },
    close: async () => {
      if (!data) await rm(userData, { recursive: true, force: true });
    },
  };
}
function errorCode(error: unknown): unknown {
  return (error as NodeJS.ErrnoException)?.code;
}
export function createNodeFiles(clock: Clock): FileAccess {
  async function write(path: string, text: string): Promise<void> {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  return {
    async read(path) {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (errorCode(error) === "ENOENT") return;
        throw error;
      }
    },
    async writeAtomic(path, content) {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await write(temporary, content);
        for (let i = 0; ; i++) {
          try {
            await rename(temporary, path);
            break;
          } catch (error) {
            if (i >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(String(errorCode(error)))) throw error;
            await clock.sleep(10);
          }
        }
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async backup(path, content) {
      await mkdir(dirname(path), { recursive: true });
      let handle: FileHandle;
      try {
        handle = await open(path, "wx", 0o600);
      } catch (error) {
        if (errorCode(error) === "EEXIST") return false;
        throw error;
      }
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } catch (error) {
        await handle.close();
        await rm(path, { force: true });
        throw error;
      }
      await handle.close();
      return true;
    },
  };
}
