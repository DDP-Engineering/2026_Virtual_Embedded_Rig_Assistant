import type { CredentialStore } from "@vera/core";
import type { CredentialFile } from "./credentials.js";

/** Main-only consent extension: refreshed tokens retain the account's explicit storage choice. */
export function subscriptionStore(
  file: CredentialFile,
  consent?: () => boolean | undefined,
): CredentialStore {
  return {
    read: (id, options) => file.read(id, options),
    list: (options) => file.list(options),
    delete: (id, options) => file.delete(id, options),
    modify: (id, fn, options) => {
      const location = file.storage(id);
      const choice =
        consent?.() ?? (location === "memory" ? false : location === "unprotected" ? true : undefined);
      return file.modify(id, fn, { ...options, ...(choice !== undefined ? { storageConsent: choice } : {}) });
    },
  };
}
