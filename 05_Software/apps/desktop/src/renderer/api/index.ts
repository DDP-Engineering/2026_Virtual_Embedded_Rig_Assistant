import type { VeraApi } from "./client.js";
import { ipcApi } from "./ipc.js";

// BenchPilot's one binding: normal builds drop the mock branch and its fixture code.
export const usingMocks = import.meta.env.VITE_API === "mock";
export const api: VeraApi = usingMocks ? (await import("../mocks/mockApi.js")).mockApi : ipcApi;
export type { VeraApi } from "./client.js";
