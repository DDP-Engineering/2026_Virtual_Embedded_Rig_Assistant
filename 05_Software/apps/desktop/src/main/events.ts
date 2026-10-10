import { type EventEnvelope, eventEnvelopeSchema } from "@vera/shared";

interface EventTarget {
  isDestroyed(): boolean;
  send(channel: string, envelope: EventEnvelope): void;
}

export function createEventEmitter(target: () => EventTarget | undefined) {
  return (envelope: EventEnvelope): boolean => {
    const parsed = eventEnvelopeSchema.parse(envelope);
    const contents = target();
    if (!contents || contents.isDestroyed()) return false;
    contents.send("vera:event", parsed);
    return true;
  };
}

/** Call flush before emitting a terminal event; dispose cancels undelivered deltas. */
export function createDeltaCoalescer<T>(options: {
  key: (value: T) => string;
  merge: (previous: T, next: T) => T;
  emit: (value: T) => void;
}) {
  const pending = new Map<string, T>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  function flush() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const batch = [...pending.values()];
    pending.clear();
    for (const value of batch) options.emit(value);
  }
  return {
    push(value: T) {
      if (disposed) return;
      const key = options.key(value);
      const previous = pending.get(key);
      pending.set(key, previous === undefined ? value : options.merge(previous, value));
      if (timer === undefined) timer = setTimeout(flush, 50);
    },
    flush,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}
