import { type EventEnvelope, isLiveSessionEvent, type SessionEvent } from "@vera/shared";
import { createDeltaCoalescer } from "./events.js";

type Envelope = Extract<EventEnvelope, { topic: "session" }>;
/** One transport per subscription; replay and terminal records flush preceding live text. */
export function createSessionTransport(id: string, subscriptionId: string, emit: (value: Envelope) => void) {
  type Delta = Extract<SessionEvent, { type: "message.delta" | "reasoning.delta" | "tool.update" }>;
  const coalescer = createDeltaCoalescer<Delta>({
    key: (e) => `${e.type}/${"callId" in e ? e.callId : e.messageId}`,
    merge: (a, b) => ({ ...b, text: a.text + b.text }),
    emit: (event) => emit({ topic: "session", id, subscriptionId, event }),
  });
  return {
    on(seq: number | undefined, event: SessionEvent) {
      if (isLiveSessionEvent(event)) coalescer.push(event as Delta);
      else {
        coalescer.flush();
        emit({ topic: "session", id, subscriptionId, ...(seq === undefined ? {} : { seq }), event });
      }
    },
    dispose: () => coalescer.dispose(),
  };
}
