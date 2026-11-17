import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { veraError } from "@vera/shared";
import { z } from "zod";

const prefix = "__vera_display_";
const marked = (part: string) => part.startsWith(prefix) && part.endsWith(".");
const keySchema = z.strictObject({ schemaVersion: z.literal(1), key: z.string().regex(/^[a-f0-9]{64}$/) });
/**
 * A host-local key makes opaque document identities stable across restarts without storing paths.
 * This never throws, so one bad file cannot keep the application from starting: a missing or damaged
 * key file gets a new key (earlier identities stop resolving), and a key that cannot be saved is
 * used for this run only.
 */
export function loadDisplayIdentityKey(file: string, warn: (event: string) => void = () => {}): Buffer {
  try {
    return Buffer.from(keySchema.parse(JSON.parse(readFileSync(file, "utf8"))).key, "hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") warn("display.identities.key.replaced");
    const key = randomBytes(32);
    const temporary = `${file}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      // Flushed and renamed into place, so a crash or power loss never leaves a truncated key file.
      writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, key: key.toString("hex") }), {
        mode: 0o600,
        flush: true,
      });
      renameSync(temporary, file);
    } catch {
      warn("display.identities.key.unsaved");
    }
    return key;
  }
}
/** Authenticated deterministic segments retain hierarchy; workbench/folder/parent are authenticated. */
export class DisplayIdentities {
  constructor(private key: Buffer) {
    if (key.length !== 32) throw veraError("INVALID");
  }
  encode(owner: string, path: string, sensitive: (path: string) => boolean = () => true): string {
    if (!path) return path;
    let parent = "";
    let encryptedTail = false;
    return path
      .split("/")
      .map((part) => {
        const originalPath = parent ? `${parent}/${part}` : part;
        if (!encryptedTail && !sensitive(originalPath) && !marked(part)) {
          parent = originalPath;
          return part;
        }
        encryptedTail = true;
        const aad = Buffer.from(JSON.stringify([owner, parent]));
        const nonce = createHmac("sha256", this.key)
          .update(JSON.stringify([owner, parent, part]))
          .digest()
          .subarray(0, 12);
        const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
        cipher.setAAD(aad);
        const encrypted = Buffer.concat([cipher.update(part, "utf8"), cipher.final()]);
        parent = parent ? `${parent}/${part}` : part;
        return `${prefix}${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url")}.`;
      })
      .join("/");
  }
  decode(owner: string, path: string): string {
    if (!path.split("/").some(marked)) return path;
    let parent = "";
    let encryptedTail = false;
    try {
      return path
        .split("/")
        .map((part) => {
          if (!marked(part)) {
            if (encryptedTail || !part || part === "." || part === "..") throw Error("Invalid segment.");
            parent = parent ? `${parent}/${part}` : part;
            return part;
          }
          encryptedTail = true;
          const encoded = part.slice(prefix.length, -1);
          if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw Error("Invalid identity.");
          const bytes = Buffer.from(encoded, "base64url");
          if (bytes.toString("base64url") !== encoded) throw Error("Invalid encoding.");
          const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
          decipher.setAAD(Buffer.from(JSON.stringify([owner, parent])));
          decipher.setAuthTag(bytes.subarray(12, 28));
          const original = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(
            "utf8",
          );
          if (!original || original.includes("/")) throw Error("Invalid segment.");
          parent = parent ? `${parent}/${original}` : original;
          return original;
        })
        .join("/");
    } catch {
      throw veraError("NOT_FOUND");
    }
  }
}
