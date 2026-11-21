import { dictationMaxSamples } from "@vera/shared";
import { expect, it, vi } from "vitest";

it("caps the worklet PCM at 480,000 samples and emits a single packed buffer", async () => {
  const postMessage = vi.fn();
  const port = { onmessage: () => {}, postMessage };
  const register = vi.fn();
  vi.stubGlobal(
    "AudioWorkletProcessor",
    class {
      readonly port = port;
    },
  );
  vi.stubGlobal("registerProcessor", register);
  try {
    await import("./pcm-worklet.js");
    const Processor = register.mock.lastCall?.[1] as new (options: {
      processorOptions: { maxSamples: number };
    }) => { process: (inputs: Float32Array[][]) => boolean };
    const worklet = new Processor({ processorOptions: { maxSamples: dictationMaxSamples } });
    const block = [[new Float32Array(128).fill(0.25)]];
    for (let remaining = dictationMaxSamples; remaining > 128; remaining -= 128) {
      expect(worklet.process(block)).toBe(true);
    }
    expect(worklet.process([[new Float32Array(256).fill(0.25)]])).toBe(false);
    port.onmessage();
    expect(worklet.process(block)).toBe(false);
    expect(postMessage).toHaveBeenCalledOnce();
    const [pcm, transfer] = postMessage.mock.lastCall ?? [];
    expect(pcm).toBeInstanceOf(Float32Array);
    const samples = pcm as Float32Array;
    expect(samples.length).toBe(480_000);
    expect(samples.byteLength).toBe(samples.buffer.byteLength);
    expect(samples[479_999]).toBe(0.25);
    expect(transfer).toEqual([samples.buffer]);
  } finally {
    vi.unstubAllGlobals();
  }
});
