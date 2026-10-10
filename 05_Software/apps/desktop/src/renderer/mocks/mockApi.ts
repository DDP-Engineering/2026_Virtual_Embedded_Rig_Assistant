import {
  type AppEvent,
  type AppInfo,
  appEventSchema,
  type Channel,
  channels,
  isChannel,
  type Request,
  type Response,
  veraError,
} from "@vera/shared";
import type { VeraApi } from "../api/client.js";
import { mockAppInfo } from "./fixtures.js";

export function createMockApi(info: AppInfo = mockAppInfo): {
  api: VeraApi;
  emitAppEvent: (event: AppEvent) => void;
} {
  const subscribers = new Set<(event: AppEvent) => void>();
  async function invoke<C extends Channel>(channel: C, request: Request<C>): Promise<Response<C>> {
    if (!isChannel(channel)) throw veraError("NOT_FOUND");
    if (!channels[channel].request.safeParse(request).success) throw veraError("INVALID");
    const parsed = channels[channel].response.safeParse(info);
    if (!parsed.success) throw veraError("INTERNAL");
    return parsed.data as Response<C>;
  }
  return {
    api: {
      invoke,
      getAppInfo: () => invoke("app.info", {}),
      subscribe(topic, on) {
        if (topic !== "app" || typeof on !== "function") throw veraError("INVALID");
        // Each registration owns its callback, even if callers reuse the same function.
        const listener = (event: AppEvent) => on(event);
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      },
    },
    emitAppEvent(event) {
      const parsed = appEventSchema.parse(event);
      for (const subscriber of subscribers) subscriber(structuredClone(parsed));
    },
  };
}
export const mockApi = createMockApi().api;
