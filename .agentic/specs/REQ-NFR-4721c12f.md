# Provider token count calibration

Status: active. Requirement: REQ-NFR-4721c12f.

- Only reported input usage of a normal model request supplies a sample. Divide the report (input plus cache read and write) by the request's conservative estimate. Ignore ratios below 0.12 and limit accepted ratios to 1. A summary call supplies no sample.
- Persist each accepted ratio as a format-1 record in application data. Key it by the complete provider/model reference and the configured connection for custom providers. Store only the ratio and version. Separate per-key atomic replacements keep reads complete and concurrent writes for different models independent.
- Restore the session's latest accepted report after reopening and keep it separate from an application hint. Before a fresh session's first request, read the matching application record. While the original model is still selected and has no accepted session report, the same session can refresh its in-memory hint. An existing session's switch to a different model counts conservatively until that model reports usage. A cache handle stops reading and writing if its connection binding changes. Missing, invalid or inaccessible cache data leaves the conservative fallback available. Cache I/O failure does not fail a turn.
- Apply the configured margin, default 1.10, and cap at the conservative estimate. The request pipeline uses the same scale for compaction, final preflight and request view reporting. Disabling provider token counts disables use of the scale.
