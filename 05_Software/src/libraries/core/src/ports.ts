/** Host-owned data locations; core does not resolve Electron paths. */
import type { EventEnvelope, SettingsPatch, SettingsSnapshot } from "@vera/shared";

/** Host-owned task isolation; grep discovery, reads and matching execute only in a worker. */
export interface GrepMatch {
  path: string;
  line: number;
  text: string;
  ref?: string;
  context?: { line: number; text: string }[];
}
export interface WorkerResult {
  matches: GrepMatch[];
  truncated: boolean;
  reason?: "timeout" | "aborted";
  error?: string;
}
export interface WorkerPool {
  run(
    task: { root: string; args: unknown; scope?: "filesystem" },
    signal: AbortSignal,
    onPartial?: (match: GrepMatch) => void,
  ): Promise<WorkerResult>;
  dispose(): Promise<void>;
}

/** Structural pi-ai 1.1.0 auth/types contract; no Electron or model runtime dependency. */
export type Credential =
  | { type: "api_key"; key?: string; env?: Record<string, string> }
  | { type: "oauth"; access: string; refresh: string; expires: number; [key: string]: unknown };
export interface CredentialInfo {
  providerId: string;
  type: Credential["type"];
}
export interface AuthOperationOptions {
  signal?: AbortSignal;
}
/** Host extension used only for an explicit weak-storage choice. */
export interface CredentialWriteOptions extends AuthOperationOptions {
  storageConsent?: boolean;
}
export interface CredentialStore {
  read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined>;
  list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]>;
  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: CredentialWriteOptions,
  ): Promise<Credential | undefined>;
  delete(providerId: string, options?: AuthOperationOptions): Promise<void>;
}

export interface WorkbenchHost {
  userData?: string;
  files: FileAccess;
  settings: { get(): SettingsSnapshot; update(patch: SettingsPatch): Promise<SettingsSnapshot> };
  pid: number;
  appVersion: string;
  now(): Date;
  isProcessAlive(pid: number): boolean;
  token(): string;
  catalogs?: { skills: readonly string[]; tools: readonly string[] };
  changed(event: Extract<EventEnvelope, { topic: "workbench" }>): void;
}
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
}
