import {
  appEventSchema,
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
    subscribe(topic, on) {
      if (!bridge) throw veraError("INTERNAL");
      return bridge.subscribe(topic, (event) => {
        const parsed = appEventSchema.safeParse(event);
        if (parsed.success) on(parsed.data);
      });
    },
  };
}

export const ipcApi = createIpcApi(window.vera);
