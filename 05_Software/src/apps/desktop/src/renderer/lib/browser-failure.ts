import type { BrowserFailureCode } from "@vera/shared";
import type { TFunction } from "i18next";

const messages = {
  "unsupported-platform": (t) => t("browser.failure.unsupported-platform"),
  "runtime-missing": (t) => t("browser.failure.runtime-missing"),
  integrity: (t) => t("browser.failure.integrity"),
  download: (t) => t("browser.failure.download"),
  cleanup: (t) => t("browser.failure.cleanup"),
  storage: (t) => t("browser.failure.storage"),
  prerequisite: (t) => t("browser.failure.prerequisite"),
  "sandbox-unavailable": (t) => t("browser.failure.sandbox-unavailable"),
  "remote-launch-configured": (t) => t("browser.failure.remote-launch-configured"),
  launch: (t) => t("browser.failure.launch"),
  "startup-timeout": (t) => t("browser.failure.startup-timeout"),
  "policy-denied": (t) => t("browser.failure.policy-denied"),
  "policy-unavailable": (t) => t("browser.failure.policy-unavailable"),
  "destination-denied": (t) => t("browser.failure.destination-denied"),
  "resource-limit": (t) => t("browser.failure.resource-limit"),
  "session-limit": (t) => t("browser.failure.session-limit"),
  "stale-reference": (t) => t("browser.failure.stale-reference"),
  "page-closed": (t) => t("browser.failure.page-closed"),
  "window-closed": (t) => t("browser.failure.window-closed"),
  "unsupported-content": (t) => t("browser.failure.unsupported-content"),
  "operation-timeout": (t) => t("browser.failure.operation-timeout"),
  "operation-limit": (t) => t("browser.failure.operation-limit"),
  "navigation-failed": (t) => t("browser.failure.navigation-failed"),
  "operation-failed": (t) => t("browser.failure.operation-failed"),
  "tab-limit": (t) => t("browser.failure.tab-limit"),
  cancelled: (t) => t("browser.failure.cancelled"),
} satisfies Record<BrowserFailureCode, (t: TFunction) => string>;

/** Translate only a validated browser failure code. */
export function browserFailureText(t: TFunction, code: BrowserFailureCode): string {
  return messages[code](t);
}
