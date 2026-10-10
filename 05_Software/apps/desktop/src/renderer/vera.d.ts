import type { VeraBridge } from "@vera/shared";

declare global {
  interface Window {
    readonly vera?: VeraBridge;
  }
}
