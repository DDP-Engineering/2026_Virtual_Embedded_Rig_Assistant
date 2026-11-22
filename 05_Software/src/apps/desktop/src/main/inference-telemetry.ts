// REQ-SEC-b4170ade: ONNX Runtime's native telemetry starts at initialization, before its API can opt out. The
// main process imports this module first, so the opt-out is in the real process environment before any
// inference host exists: document embeddings in the Indexer utility process and Whisper dictation, and their
// workers, inherit it. Evaluating @vera/core first is safe: no module of it starts a worker on import. Core's
// EmbeddingHost applies the same rule for the hosts that do not start here, such as the CLI.
import { disableOnnxRuntimeTelemetry } from "@vera/core";

disableOnnxRuntimeTelemetry();
