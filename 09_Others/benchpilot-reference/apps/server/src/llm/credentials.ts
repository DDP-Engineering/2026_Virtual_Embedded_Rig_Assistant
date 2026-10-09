// LLM settings and credentials live in RUNTIME_DIR files, not the DB: `resetDb` recreates every table and reset must
// keep them (P2 decision). Secrets stay server-side: nothing here is logged, and GET /settings/llm returns masks only.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import type { ProviderId } from "@benchpilot/shared";

/** Credential slots in credentials.json. `chatgpt` holds the OAuth tokens; the others API keys. */
export type CredentialSlot = "anthropic" | "openai" | "custom" | "chatgpt";

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    // A corrupt file must not take the server down; the next write replaces it.
    return fallback;
  }
}

/**
 * Write-then-rename, so a crash never leaves half a file behind. On Windows a rename over a file that a scanner or
 * indexer has just opened can fail with EPERM/EBUSY for a few ms, so it is retried briefly.
 */
function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 20 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); // 10 ms, synchronous
    }
  }
}

/**
 * The one credentials file, `<RUNTIME_DIR>/credentials.json`. Writes are serialised through a promise chain
 * (single server process; the CLI and the server do not write concurrently in this PoC).
 */
export class CredentialsFile {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly file: string) {}

  private all(): Partial<Record<CredentialSlot, Credential>> {
    return readJson(this.file, {});
  }

  get(slot: CredentialSlot): Credential | undefined {
    return this.all()[slot];
  }

  slots(): CredentialSlot[] {
    return Object.keys(this.all()) as CredentialSlot[];
  }

  modify(slot: CredentialSlot, fn: (cur: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    const run = this.chain.then(async () => {
      const data = this.all();
      const next = await fn(data[slot]);
      if (next === undefined) return data[slot];
      writeJson(this.file, { ...this.all(), [slot]: next });
      return next;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  remove(slot: CredentialSlot): Promise<void> {
    const run = this.chain.then(() => {
      const { [slot]: _gone, ...rest } = this.all();
      writeJson(this.file, rest);
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  setApiKey(slot: Exclude<CredentialSlot, "chatgpt">, key: string): Promise<unknown> {
    return this.modify(slot, async () => ({ type: "api_key", key }));
  }

  apiKey(slot: Exclude<CredentialSlot, "chatgpt">): string | undefined {
    const c = this.get(slot);
    return c?.type === "api_key" ? c.key : undefined;
  }
}

/**
 * A pi-ai `CredentialStore` view of the file. `slots` maps pi-ai provider ids to file slots, so two `Models`
 * collections can share pi-ai's `openai` provider: the API one sees slot `openai`, the subscription one `chatgpt`.
 */
export function credentialStoreView(file: CredentialsFile, slots: Record<string, CredentialSlot>): CredentialStore {
  const slotOf = (providerId: string) => slots[providerId];
  return {
    async read(providerId: string, _o?: AuthOperationOptions) {
      const slot = slotOf(providerId);
      return slot ? file.get(slot) : undefined;
    },
    async list(_o?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
      return Object.entries(slots)
        .map(([providerId, slot]) => ({ providerId, cred: file.get(slot) }))
        .filter((x): x is { providerId: string; cred: Credential } => Boolean(x.cred))
        .map(({ providerId, cred }) => ({ providerId, type: cred.type }));
    },
    async modify(providerId, fn, _o?: AuthOperationOptions) {
      const slot = slotOf(providerId);
      if (!slot) throw new Error(`no credential slot for provider ${providerId}`);
      return file.modify(slot, fn);
    },
    async delete(providerId: string, _o?: AuthOperationOptions) {
      const slot = slotOf(providerId);
      if (slot) await file.remove(slot);
    },
  };
}

// ---------------------------------------------------------------- settings.json (non-secret)

export interface ProviderSettings {
  model: string | null;
  baseUrl: string | null;
}

export interface SettingsData {
  active: ProviderId | null;
  providers: Record<Exclude<ProviderId, "replay">, ProviderSettings>;
  /** Stable UUID of this installation (pi-ai's ChatGPT login sends it as the agent host id). */
  installationId: string;
}

export const DEFAULT_MODELS: Record<Exclude<ProviderId, "replay" | "custom">, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-5.5",
  chatgpt: "gpt-5.5",
};

const defaults = (): SettingsData => ({
  active: null,
  providers: {
    anthropic: { model: DEFAULT_MODELS.anthropic, baseUrl: null },
    openai: { model: DEFAULT_MODELS.openai, baseUrl: null },
    custom: { model: null, baseUrl: null },
    chatgpt: { model: DEFAULT_MODELS.chatgpt, baseUrl: null },
  },
  installationId: randomUUID(),
});

export class SettingsFile {
  constructor(readonly file: string) {}

  read(): SettingsData {
    const d = defaults();
    const stored = readJson<Partial<SettingsData>>(this.file, {});
    const data: SettingsData = {
      active: stored.active ?? d.active,
      providers: { ...d.providers },
      installationId: stored.installationId ?? d.installationId,
    };
    for (const id of Object.keys(d.providers) as (keyof SettingsData["providers"])[])
      data.providers[id] = { ...d.providers[id], ...(stored.providers?.[id] ?? {}) };
    if (!stored.installationId) writeJson(this.file, data); // persist the id on first use
    return data;
  }

  write(next: SettingsData): void {
    writeJson(this.file, next);
  }

  update(fn: (cur: SettingsData) => SettingsData): SettingsData {
    const next = fn(this.read());
    this.write(next);
    return next;
  }
}

export const settingsFiles = (runtimeDir: string) => ({
  settings: new SettingsFile(path.join(runtimeDir, "settings.json")),
  credentials: new CredentialsFile(path.join(runtimeDir, "credentials.json")),
});

/** `••••1234` — the only form a key ever leaves the server in. */
export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  return `••••${key.slice(-4)}`;
}
