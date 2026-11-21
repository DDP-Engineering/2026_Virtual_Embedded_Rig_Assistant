import { dictationMaxSamples, dictationPcmSchema, dictationSampleRate } from "@vera/shared";
import workletUrl from "./pcm-worklet.ts?worker&url";

interface MicrophoneInput {
  start(): void;
  stop(): void;
  close(): void;
}

export type Microphone = (
  signal: AbortSignal,
  onPcm: (pcm: Float32Array) => void,
  onDisconnected: () => void,
  onFailure: () => void,
) => Promise<MicrophoneInput>;

/** The input never reaches the speakers. The output connection only keeps the worklet scheduled. */
export const openMicrophone: Microphone = async (signal, onPcm, onDisconnected, onFailure) => {
  if (!navigator.mediaDevices) throw new DOMException("Microphone unavailable", "NotFoundError");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const tracks = stream.getTracks();
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  const releaseTracks = () => {
    for (const track of tracks) {
      track.removeEventListener("ended", onDisconnected);
      track.stop();
    }
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    releaseTracks();
    source?.disconnect();
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.port.close();
      worklet.disconnect();
      worklet.onprocessorerror = null;
    }
    if (context && context.state !== "closed") void context.close().catch(() => {});
  };
  try {
    signal.throwIfAborted();
    signal.addEventListener("abort", close, { once: true });
    if (tracks.length !== 1 || tracks[0]?.readyState !== "live" || !tracks[0].enabled) {
      throw new DOMException("Microphone unavailable", "NotReadableError");
    }
    tracks[0].addEventListener("ended", onDisconnected, { once: true });
    context = new AudioContext({ sampleRate: dictationSampleRate });
    if (context.sampleRate !== dictationSampleRate) throw new Error("Unexpected audio sample rate");
    await context.audioWorklet.addModule(workletUrl);
    signal.throwIfAborted();
    source = context.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(context, "vera-dictation-pcm", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: { maxSamples: dictationMaxSamples },
    });
    worklet.port.onmessage = (event: MessageEvent<unknown>) => {
      const parsed = dictationPcmSchema.safeParse(event.data);
      if (parsed.success) onPcm(parsed.data);
      else onFailure();
    };
    worklet.onprocessorerror = onFailure;
    await context.resume();
    signal.throwIfAborted();
    const input = source;
    const processor = worklet;
    const sink = context.destination;
    return {
      start() {
        input.connect(processor);
        processor.connect(sink);
      },
      stop() {
        releaseTracks();
        processor.port.postMessage("stop");
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
};
