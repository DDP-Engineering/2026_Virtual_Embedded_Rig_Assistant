/** Host-owned data locations; core does not resolve Electron paths. */
export interface PathProvider {
  readonly userData: string;
  readonly settings: string;
  readonly logs: string;
}
export interface Clock {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
}
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
  log(level: LogLevel, message: string, data?: unknown): void;
  registerSecret(secret: string): () => void;
  flush(): Promise<void>;
}
export interface FileAccess {
  /** undefined means ENOENT only; permission and other I/O failures reject. */
  read(path: string): Promise<string | undefined>;
  writeAtomic(path: string, content: string): Promise<void>;
  /** Exclusive durable backup; false when this backup name already exists. */
  backup(path: string, content: string): Promise<boolean>;
}
