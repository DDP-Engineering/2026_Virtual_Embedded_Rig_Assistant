import type { VeraApi } from "./client.js";
import { ipcApi } from "./ipc.js";

// BenchPilot's one binding: normal builds drop the mock branch and its fixture code.
export const usingMocks = import.meta.env.VITE_API === "mock";
export const api: VeraApi = usingMocks ? (await import("../mocks/mockApi.js")).mockApi : ipcApi;
declare const __VERA_SESSION_PERF__: boolean;
if (typeof __VERA_SESSION_PERF__ !== "undefined" && __VERA_SESSION_PERF__)
  (await import("./session-performance.js")).instrumentSessionApi(api);

export type { VeraApi } from "./client.js";
