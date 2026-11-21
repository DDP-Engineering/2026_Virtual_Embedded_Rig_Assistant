// REQ-SEC-b4170ade: ONNX Runtime's native telemetry uploader starts at initialization, before its API can opt
// out. The main process imports this module first, so every inference host it creates later (document
// embeddings, Whisper dictation) and their workers inherit the opt-out from the real process environment.
process.env.ORT_DISABLE_TELEMETRY = "1";

export {};
