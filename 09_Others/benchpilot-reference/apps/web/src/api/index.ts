import type { BenchPilotApi } from "./client";
import { httpApi } from "./http";

/**
 * The one binding (P4a decision). Default: the real server over HTTP + EventSource.
 * `VITE_API=mock` (or `npm run dev:mock`, i.e. `vite --mode mock`) runs the UI on the in-memory mocks without a server.
 * The flag is a build-time constant, so a normal build drops the dynamic import and ships no mock code.
 */
export const usingMocks = import.meta.env.VITE_API === "mock";

export const api: BenchPilotApi = usingMocks ? (await import("@/mocks/mockApi")).mockApi : httpApi;

export * from "./client";
