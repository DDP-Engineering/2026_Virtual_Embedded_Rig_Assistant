import {
  type Channel,
  channels,
  isChannel,
  type Request,
  type Response,
  type VeraBridge,
  veraError,
  veraErrorSchema,
} from "@vera/shared";
import type { VeraApi } from "./client.js";
import { createSubscriptions } from "./subscriptions.js";

export function createIpcApi(bridge: VeraBridge | undefined): VeraApi {
  async function invoke<C extends Channel>(channel: C, request: Request<C>): Promise<Response<C>> {
    if (!isChannel(channel)) throw veraError("NOT_FOUND");
    const input = channels[channel].request.safeParse(request);
    if (!input.success) throw veraError("INVALID");
    if (!bridge) throw veraError("INTERNAL");
    let value: unknown;
    try {
      value = await bridge.invoke(channel, input.data as Request<C>);
    } catch (error: unknown) {
      const known = veraErrorSchema.safeParse(error);
      throw known.success ? known.data : veraError("INTERNAL");
    }
    const output = channels[channel].response.safeParse(value);
    if (!output.success) throw veraError("INTERNAL");
    return output.data as Response<C>;
  }
  return {
    invoke,
    getAppInfo: () => invoke("app.info", {}),
    getSettings: () => invoke("app.settings.get", {}),
    updateSettings: (patch) => invoke("app.settings.update", patch),
    subscribe: createSubscriptions((topic, id, on) => {
      if (!bridge) throw veraError("INTERNAL");
      return topic === "app" ? bridge.subscribe("app", on) : bridge.subscribe("workbench", id ?? "", on);
    }),
  };
}

export const ipcApi = createIpcApi(window.vera);
