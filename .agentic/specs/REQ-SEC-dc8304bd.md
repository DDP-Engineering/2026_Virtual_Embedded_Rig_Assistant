# Dictation capture protocol

Requirement REQ-SEC-dc8304bd governs the microphone grant. The default denial rule
applies to every other permission, sender and stage.

## Opening the microphone

The sandboxed preload accepts dictation.begin only during a trusted input event
with transient Chromium user activation. A successful call consumes that event.
The main IPC router authorizes the live VERA main frame at the exact renderer URL.
Main also requires focus and reserves the single active UUID during model verification.

Once main resolves a verified model, it opens a 15-second grant. The Electron
request handler accepts a single audio-only media request from that focused main
frame. The permission check handler recognizes audio only during the opening phase.
Video, combined audio/video, missing media details, other contents, subframes and
different URLs are denied. Recording acknowledgement closes the grant.

## Audio and ownership

The renderer opens one stream, resamples through a 16 kHz AudioContext, and receives
one downmixed channel at the AudioWorklet. Up to 480,000 samples are collected.
Stop ends the tracks before flushing PCM. The IPC submit accepts packed Float32
with finite samples in [-1, 1]; a bound violation returns INVALID. Empty PCM or
mean squared amplitude below 0.000001 returns no-speech. Transcription is limited
to 120 seconds and the worker returns bounded text and a language token.

The renderer discards late results when its session changes, and closes tracks on
cancellation, blur, page departure or an ended track. Acquisition timeout or cancellation frees
the job for retry. A late browser stream is stopped before its audio graph opens. Successful
renderer results include the originating session key for the draft caller to verify. Main closes the lease on blur,
navigation, renderer loss, window close or shutdown. Cancellation takes effect
before worker cleanup, and the admission slot is released after termination. A
separate job UUID is required for each start. The model and spoken language selected
during reservation remain fixed. Removal is unavailable while a job holds a model.

The worker checks the catalog file set and hashes, uses the CPU ONNX path with
remote access disabled, and terminates when the job settles. The audio and text
stay in memory through capture and transcription.
