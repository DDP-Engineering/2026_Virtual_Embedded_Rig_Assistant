declare const AudioWorkletProcessor: { new (): { readonly port: MessagePort } };
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class DictationPcm extends AudioWorkletProcessor {
  private readonly samples: Float32Array;
  private used = 0;
  private sent = false;

  constructor(options?: { processorOptions?: { maxSamples: number } }) {
    super();
    this.samples = new Float32Array(options?.processorOptions?.maxSamples ?? 0);
    this.port.onmessage = () => this.finish();
  }

  private finish(): void {
    if (this.sent) return;
    this.sent = true;
    const pcm = this.samples.slice(0, this.used);
    this.port.postMessage(pcm, [pcm.buffer]);
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.sent) return false;
    const input = inputs[0]?.[0];
    if (input) {
      const count = Math.min(input.length, this.samples.length - this.used);
      for (let i = 0; i < count; i++) {
        this.samples[this.used++] = Math.max(-1, Math.min(1, input[i] ?? 0));
      }
      if (this.used === this.samples.length) this.finish();
    }
    return !this.sent;
  }
}

registerProcessor("vera-dictation-pcm", DictationPcm);

export {};
