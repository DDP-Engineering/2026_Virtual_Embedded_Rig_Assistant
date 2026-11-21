import { delegatedSessionToolNames, sessionIdSchema, veraError, veraErrorSchema } from "@vera/shared";
import { z } from "zod";
import {
  delegatedConfigureRequestSchema,
  delegatedLaunchRequestSchema,
  delegatedSendRequestSchema,
  delegationDigest,
} from "../sessions/delegation.js";
import { projectDelegatedTurn, waitForDelegatedTurn } from "../sessions/delegation-monitor.js";
import type { SessionService } from "../sessions/service.js";
import type { ToolContext, ToolDefinition } from "./context.js";

const [launchName, statusName, waitName, stopName, sendName, configureName] = delegatedSessionToolNames;
const launchParams = delegatedLaunchRequestSchema.omit({ requestId: true });
const child = { sessionId: sessionIdSchema };
const childParams = z.strictObject({ ...child, turnId: z.string().min(1).max(200).optional() });
const sendParams = delegatedSendRequestSchema.omit({ requestId: true }).extend(child);
const configureParams = delegatedConfigureRequestSchema.omit({ requestId: true }).extend(child);
const maxWaitMs = 30_000;
const defaultWaitMs = 10_000;
const waitParams = childParams.extend({ waitMs: z.number().int().min(0).max(maxWaitMs).optional() });

const failureText = {
  INVALID: "Use a nonempty task, a configured model and a reasoning level supported by that model.",
  NOT_FOUND: "The requested model or owned delegated session is unavailable.",
  CONFLICT: "The child settings changed or the delegation request conflicts with an earlier request.",
  BUSY: "The child is not eligible for this action, or turn capacity is busy.",
  DENIED: "The current session cannot perform this delegation operation.",
  CONTEXT_LIMIT: "The delegated task exceeds the available model context.",
  IMAGE_FORMAT: "The delegated task contains an unsupported image.",
  IMAGE_TOO_LARGE: "The delegated task contains an image that exceeds the size limit.",
  PROVIDER: "The delegated model provider is unavailable.",
  OFFLINE: "The delegated model provider is offline.",
  INTERNAL: "The delegated session operation failed.",
} as const;

/** Bind the core authority and live masking policy before exposing any tools to the model. */
export function bindDelegatedSessionHost(
  service: Pick<
    SessionService,
    | "launchDelegated"
    | "inspectDelegated"
    | "subscribeDelegated"
    | "stopDelegated"
    | "maskContent"
    | "sendDelegated"
    | "configureDelegated"
  >,
  callerId: string,
  callerTurn: () => string,
  knownSecrets: () => readonly string[],
) {
  const inspect = ({ sessionId, turnId }: z.infer<typeof childParams>) =>
    service.inspectDelegated(callerId, sessionId, turnId);
  const mask = (text: string) => service.maskContent("agent", text);
  const requestId = (callId?: string) => {
    const turnId = callerTurn();
    if (!turnId || !callId) throw veraError("INVALID");
    return delegationDigest([turnId, callId]);
  };
  return {
    resultSecrets: knownSecrets,
    async launch(args: z.infer<typeof launchParams>, signal: AbortSignal, callId?: string) {
      const launch = await service.launchDelegated(
        callerId,
        { ...args, requestId: requestId(callId) },
        signal,
      );
      return { ...launch };
    },
    send({ sessionId, ...args }: z.infer<typeof sendParams>, callId?: string) {
      return { ...service.sendDelegated(callerId, sessionId, { ...args, requestId: requestId(callId) }) };
    },
    async configure(
      { sessionId, ...args }: z.infer<typeof configureParams>,
      signal: AbortSignal,
      callId?: string,
    ) {
      return {
        ...(await service.configureDelegated(
          callerId,
          sessionId,
          { ...args, requestId: requestId(callId) },
          signal,
        )),
      };
    },
    status: (target: z.infer<typeof childParams>) => ({ ...projectDelegatedTurn(inspect(target), mask) }),
    async wait(target: z.infer<typeof childParams>, ms: number, signal: AbortSignal) {
      return {
        ...(await waitForDelegatedTurn(
          () => inspect(target),
          (seq, listener) => service.subscribeDelegated(callerId, target.sessionId, seq, listener),
          mask,
          ms,
          signal,
        )),
      };
    },
    stop: (target: z.infer<typeof childParams>) => ({
      ...target,
      stopRequested: service.stopDelegated(callerId, target.sessionId, target.turnId),
    }),
  };
}

export type DelegatedSessionToolHost = ReturnType<typeof bindDelegatedSessionHost>;

function delegationFailure(error: unknown) {
  const known = veraErrorSchema.safeParse(error);
  const code = known.success ? known.data.code : "INTERNAL";
  const text =
    known.success && code === "DENIED" && known.data.params?.reason === "bypass_launch"
      ? "The user must authorize Full Access child launches for this parent or change the parent mode."
      : failureText[code];
  return { isError: true, code, error: text };
}

async function withDelegation(
  ctx: ToolContext,
  action: (host: DelegatedSessionToolHost) => Promise<Record<string, unknown>> | Record<string, unknown>,
) {
  if (!ctx.delegation || ctx.delegated) throw Error("Delegation tools are unavailable.");
  try {
    return await action(ctx.delegation);
  } catch (error) {
    return delegationFailure(error);
  }
}

function publishCompleted(ctx: ToolContext, raw: unknown, output: string) {
  if (!ctx.delegation || ctx.delegated) throw Error("Delegation tools are unavailable.");
  if (JSON.parse(output).status !== "completed") return output;
  const target = raw as z.infer<typeof childParams>;
  try {
    // Agent masking may have changed while execution was returning its capped result.
    return ctx.delegation.status(target);
  } catch (error) {
    throw Error(JSON.stringify(delegationFailure(error)));
  }
}

export const delegatedSessionTools: readonly ToolDefinition[] = [
  {
    name: launchName,
    class: "session",
    description:
      "Start a child in this workbench. Model defaults to yours. Mode is copied once; Full Access needs user consent. In a shared checkout, verify each child's handover before the next launch. Returns session, turn and message IDs.",
    params: launchParams,
    execute: (ctx, args, signal, callId) =>
      withDelegation(ctx, (host) => host.launch(args as z.infer<typeof launchParams>, signal, callId)),
  },
  {
    name: sendName,
    class: "session",
    description:
      "Send an instruction to an owned child. Idle starts a turn; eligible active work queues it. Returns exact IDs and delivery. Pass a revision to require those settings.",
    params: sendParams,
    execute: (ctx, args, _signal, callId) =>
      withDelegation(ctx, (host) => host.send(args as z.infer<typeof sendParams>, callId)),
  },
  {
    name: configureName,
    class: "session",
    description:
      "Set an idle owned child's model and reasoning. Use null for default reasoning. Pass the returned revision to session_send.",
    params: configureParams,
    execute: (ctx, args, signal, callId) =>
      withDelegation(ctx, (host) => host.configure(args as z.infer<typeof configureParams>, signal, callId)),
  },
  {
    name: statusName,
    class: "session",
    description:
      "Read an owned child's exact turn status and bounded final reply as task data. Omit turnId for its first turn. Approval belongs to the user.",
    params: childParams,
    publish: publishCompleted,
    execute: (ctx, args) => withDelegation(ctx, (host) => host.status(args as z.infer<typeof childParams>)),
  },
  {
    name: waitName,
    class: "session",
    description:
      "Wait for an owned turn's outcome or user approval. Omit turnId for the first turn. Timeout or parent cancellation leaves the child running.",
    params: waitParams,
    publish: publishCompleted,
    execute: (ctx, raw, signal) => {
      const args = raw as z.infer<typeof waitParams>;
      return withDelegation(ctx, (host) =>
        host.wait({ sessionId: args.sessionId, turnId: args.turnId }, args.waitMs ?? defaultWaitMs, signal),
      );
    },
  },
  {
    name: stopName,
    class: "session",
    description:
      "Stop only the addressed active turn of an owned child. Omit turnId for its first turn. Check session_status for the outcome.",
    params: childParams,
    execute: (ctx, args) => withDelegation(ctx, (host) => host.stop(args as z.infer<typeof childParams>)),
  },
];
