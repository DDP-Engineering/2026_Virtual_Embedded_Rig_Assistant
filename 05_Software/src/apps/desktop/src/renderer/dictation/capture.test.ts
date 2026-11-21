import { dictationConnectionMs, type VeraBridge } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { DictationCapture } from "./capture.js";
import type { Microphone } from "./microphone.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function fixture() {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === "dictation.begin") return { status: "opening" };
    if (channel === "dictation.recording") return { status: "recording" };
    if (channel === "dictation.finish") return { status: "complete", text: "Hello!", language: "en" };
    return {};
  });
  const input = { start: vi.fn(), stop: vi.fn(), close: vi.fn() };
  let output: ((pcm: Float32Array) => void) | undefined;
  let disconnect: (() => void) | undefined;
  const open = vi.fn<Microphone>(async (_signal, pcm, lost) => {
    output = pcm;
    disconnect = lost;
    return input;
  });
  const change = vi.fn();
  const controller = new DictationCapture(invoke as VeraBridge["invoke"], change, open);
  controller.setSession("session-a");
  const start = async () => {
    const calls = input.start.mock.calls.length + 1;
    const done = controller.start();
    await vi.waitFor(() => expect(input.start).toHaveBeenCalledTimes(calls));
    return { done };
  };
  return {
    controller,
    invoke,
    input,
    change,
    open,
    start,
    output: (pcm: Float32Array) => output?.(pcm),
    disconnect: () => disconnect?.(),
  };
}

it("releases the microphone at stop and passes the final audio through the typed boundary", async () => {
  const { controller, input, invoke, output, start } = fixture();
  const { done } = await start();
  await expect(controller.start()).resolves.toEqual({ status: "busy" });
  controller.stop();
  expect(input.stop).toHaveBeenCalledOnce();
  const pcm = Float32Array.of(0.1);
  output(pcm);
  await expect(done).resolves.toEqual({
    status: "complete",
    text: "Hello!",
    language: "en",
    session: "session-a",
  });
  expect(invoke).toHaveBeenCalledWith("dictation.finish", { id: expect.any(String), pcm });
  expect(input.close).toHaveBeenCalledOnce();
});

it("cancels and closes a capture when its microphone disconnects", async () => {
  const { input, invoke, disconnect, start } = fixture();
  const { done } = await start();
  disconnect();
  await expect(done).resolves.toEqual({ status: "microphone-disconnected" });
  expect(input.close).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith("dictation.cancel", { id: expect.any(String) });
});

it("rejects stale results after a session change, even when the worker completes later", async () => {
  const { controller, invoke, output, start } = fixture();
  const stale = deferred<{ status: string; text: string; language: string }>();
  const { done } = await start();
  invoke.mockReturnValueOnce(stale.promise);
  output(Float32Array.of(0.1));
  controller.setSession("session-b");
  await expect(done).resolves.toEqual({ status: "cancelled" });
  stale.resolve({ status: "complete", text: "Stale", language: "en" });
  const next = await start();
  output(Float32Array.of(0.1));
  await expect(next.done).resolves.toMatchObject({ text: "Hello!" });
});

it("closes late microphone acquisition and maps missing, disabled and denied devices", async () => {
  const { controller, open, input } = fixture();
  for (const [name, status] of [
    ["NotFoundError", "microphone-unavailable"],
    ["NotReadableError", "microphone-unavailable"],
    ["NotAllowedError", "permission-denied"],
  ] as const) {
    open.mockRejectedValueOnce(new DOMException("Test microphone", name));
    await expect(controller.start()).resolves.toEqual({ status });
  }
  const late = deferred<typeof input>();
  open.mockReturnValueOnce(late.promise);
  const done = controller.start();
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(4));
  controller.cancel();
  await expect(done).resolves.toEqual({ status: "cancelled" });
  const next = controller.start();
  await vi.waitFor(() => expect(input.start).toHaveBeenCalledOnce());
  const abandoned = { start: vi.fn(), stop: vi.fn(), close: vi.fn() };
  late.resolve(abandoned);
  await vi.waitFor(() => expect(abandoned.close).toHaveBeenCalledOnce());
  expect(abandoned.start).not.toHaveBeenCalled();
  controller.cancel();
  await expect(next).resolves.toEqual({ status: "cancelled" });
});

it("admits another capture after an opening request never settles", async () => {
  vi.useFakeTimers();
  try {
    const { controller, input, open } = fixture();
    open.mockReturnValueOnce(new Promise(() => {}));
    const abandoned = controller.start();
    await vi.advanceTimersByTimeAsync(dictationConnectionMs);
    await expect(abandoned).resolves.toEqual({ status: "microphone-unavailable" });
    const next = controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(input.start).toHaveBeenCalledOnce();
    controller.cancel();
    await expect(next).resolves.toEqual({ status: "cancelled" });
  } finally {
    vi.useRealTimers();
  }
});

it("suppresses completion when the idle notification synchronously rebinds the session", async () => {
  const { controller, change, output, start } = fixture();
  change.mockImplementation((phase) => {
    if (phase === "idle") controller.setSession("session-b");
  });
  const { done } = await start();
  output(Float32Array.of(0.1));
  await expect(done).resolves.toEqual({ status: "cancelled" });
});
