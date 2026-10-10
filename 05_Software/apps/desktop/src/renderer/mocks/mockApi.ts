import {
  type AppEvent,
  type AppInfo,
  appEventSchema,
  type Channel,
  channels,
  defaultSettings,
  isChannel,
  mergeSettings,
  type Request,
  type Response,
  settingsPatchSchema,
  veraError,
} from "@vera/shared";
import type { VeraApi } from "../api/client.js";
import { mockAppInfo } from "./fixtures.js";

export function createMockApi(info: AppInfo = mockAppInfo): {
  api: VeraApi;
  emitAppEvent: (event: AppEvent) => void;
} {
  const subscribers = new Set<(event: AppEvent) => void>();
  let settings = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
  function emitAppEvent(event: AppEvent) {
    const parsed = appEventSchema.parse(event);
    for (const subscriber of subscribers) {
      try {
        subscriber(structuredClone(parsed));
      } catch {
        /* one observer cannot block others */
      }
    }
  }
  async function invoke<C extends Channel>(channel: C, request: Request<C>): Promise<Response<C>> {
    if (!isChannel(channel)) throw veraError("NOT_FOUND");
    if (!channels[channel].request.safeParse(request).success) throw veraError("INVALID");
    if (channel === "app.settings.update") {
      const next = mergeSettings(settings, settingsPatchSchema.parse(request));
      if (JSON.stringify(next) !== JSON.stringify(settings)) {
        settings = next;
        emitAppEvent({ type: "settings.changed" });
      }
    }
    const value = channel === "app.info" ? info : { settings, readOnly: false };
    const parsed = channels[channel].response.safeParse(value);
    if (!parsed.success) throw veraError("INTERNAL");
    return structuredClone(parsed.data) as Response<C>;
  }
  return {
    api: {
      invoke,
      getAppInfo: () => invoke("app.info", {}),
      getSettings: () => invoke("app.settings.get", {}),
      updateSettings: (patch) => invoke("app.settings.update", patch),
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
    emitAppEvent,
  };
}
export const mockApi = createMockApi().api;
