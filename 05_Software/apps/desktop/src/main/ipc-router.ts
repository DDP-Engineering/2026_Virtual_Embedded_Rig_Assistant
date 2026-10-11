import {
  type Channel,
  channels,
  type InvokeResult,
  isChannel,
  type Request,
  type Response,
  veraError,
  veraErrorSchema,
} from "@vera/shared";

interface Frame {
  readonly url: string;
}
interface Contents {
  readonly mainFrame: Frame;
  isDestroyed(): boolean;
}
export interface InvokeSender {
  readonly sender: Contents;
  readonly senderFrame: Frame | null;
}
export interface RendererTarget {
  webContents: Contents;
  url: string;
}
export type ChannelHandlers = { [C in Channel]: (request: Request<C>) => Response<C> | Promise<Response<C>> };
export interface IpcFailure {
  channel: Channel;
  reason: "handler" | "response";
}

export function createInvokeRouter(options: {
  target: () => RendererTarget | undefined;
  handlers: ChannelHandlers;
  log: (failure: IpcFailure) => void;
  sanitize?: <T>(value: T) => T;
}) {
  function authorized(event: InvokeSender): boolean {
    // Native frame accessors can throw once a renderer/frame has been detached.
    try {
      const target = options.target();
      return (
        !!target &&
        !target.webContents.isDestroyed() &&
        event.sender === target.webContents &&
        !!event.senderFrame &&
        event.senderFrame === target.webContents.mainFrame &&
        event.senderFrame.url === target.url
      );
    } catch {
      return false;
    }
  }
  function internal(channel: Channel, reason: IpcFailure["reason"]): InvokeResult<Channel> {
    // Logging never carries untrusted values and cannot break the response path.
    try {
      options.log({ channel, reason });
    } catch {
      /* logger failure must not crash IPC */
    }
    return { ok: false, error: veraError("INTERNAL") };
  }
  function dispatch<C extends Channel>(name: C, request: Request<C>): Response<C> | Promise<Response<C>> {
    return options.handlers[name](request);
  }
  return async (event: InvokeSender, name: unknown, payload: unknown): Promise<InvokeResult<Channel>> => {
    if (!authorized(event)) {
      return { ok: false, error: veraError("DENIED") };
    }
    if (!isChannel(name)) return { ok: false, error: veraError("NOT_FOUND") };
    const channel = channels[name];
    const request = channel.request.safeParse(payload);
    if (!request.success) return { ok: false, error: veraError("INVALID") };
    try {
      const value = await dispatch(name, request.data);
      const response = channel.response.safeParse(value);
      if (!response.success) return internal(name, "response");
      return { ok: true, value: response.data };
    } catch (error: unknown) {
      const known = veraErrorSchema.safeParse(error);
      if (!known.success) return internal(name, "handler");
      const messageKey = options.sanitize?.(known.data.messageKey) ?? known.data.messageKey;
      return {
        ok: false,
        error: {
          ...known.data,
          messageKey: messageKey === known.data.messageKey ? messageKey : `errors.${known.data.code}`,
          ...(known.data.params
            ? { params: options.sanitize?.(known.data.params) ?? known.data.params }
            : {}),
        },
      };
    }
  };
}
