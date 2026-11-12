# Current session-loading behavior — Windows, 2026-11-12

Status: descriptive measurement only. No regression reference has been calibrated, no performance gate is activated, and no session-loader or rendering optimization was made. The broader PERF-01 implementation remains unfinished.

## Method

360/360 valid native Electron samples:30 for each of12 cases. Fictional current-format persisted sessions were opened through the real sidebar and storage/IPC/UI path in an isolated compiled test build. The real user profile/workbenches were not measured or modified. Each load ends after correct content, unsent draft input and actual history scrolling. Full canonical content hashes were checked at main and renderer API boundaries outside the timer. No provider requests or external attempts were recorded.

First = first target open in a fresh app process after opening its workbench; warm = reopen A after B; cross = select the target from a small anchor session. OS disk caches were not flushed. Timings include Playwright interaction/check overhead and opt-in instrumentation, and are not claimed to exactly match an uninstrumented release or the user's original session.

## Observed load times

Seconds, with30 samples in every row. Median averages the middle pair; p95 uses nearest rank.

| Session | Scenario | Median s | p95 s | Maximum s |
|---|---|---:|---:|---:|
| 20 messages | first | 0.424 | 0.503 | 0.575 |
| 20 messages | warm | 0.206 | 0.239 | 0.256 |
| 20 messages | cross | 0.206 | 0.272 | 0.273 |
| 200 messages | first | 1.063 | 1.163 | 1.408 |
| 200 messages | warm | 0.711 | 1.178 | 1.525 |
| 200 messages | cross | 0.611 | 0.742 | 0.901 |
| 2,000 messages | first | 9.504 | 13.607 | 18.346 |
| 2,000 messages | warm | 11.635 | 12.752 | 16.356 |
| 2,000 messages | cross | 11.856 | 12.913 | 13.206 |
| 200 messages +64 KiB tool previews | first | 2.441 | 2.546 | 2.559 |
| 200 messages +64 KiB tool previews | warm | 1.797 | 1.852 | 1.859 |
| 200 messages +64 KiB tool previews | cross | 1.877 | 1.960 | 2.280 |

## Where time was observed

Median milliseconds. Phases overlap and must not be added as independent durations. IPC includes the main handler; presentation includes UI work and automated interaction checks.

| Case | Event SQL reads | Snapshot reconstruction | API round trip | Presentation/checks |
|---|---:|---:|---:|---:|
| medium/first | 1.0 | 77.2 | 144.5 | 872.7 |
| large/first | 6.8 | 5048.4 | 5148.8 | 4304.4 |
| large/warm | 4.1 | 6034.7 | 6111.2 | 5203.9 |
| large/cross | 4.7 | 6464.0 | 6528.2 | 5230.3 |
| payload/first | 3.3 | 964.9 | 1033.0 | 1348.0 |

## Responsiveness and interpretation

The largest observed main-process heartbeat gap was12.623s; the largest renderer gap was8.600s. These are20ms-timer intervals including scheduling/instrumentation overhead, not an exact Windows not-responding duration. All data loaded correctly despite the delays.

For the synthetic2,000-message case, SQL event reading was only about4–7ms at the median, while snapshot reconstruction was about5–6.5s. Another4–5s elapsed from API receipt through usable presentation/checks. This supports examining snapshot reconstruction and UI work before optimizing SQL, but does not establish the cause of the user's specific original delay. No memory leak is inferred from working-set growth.

This is an observation, not a pass/fail judgment against latency targets. The2s/250ms budget proposal and regression calibration were deferred when the user limited the current request to measurement. The second sweep was interrupted and is not counted in this report.

Folder naming note: the harness and output folders were renamed after this measurement. Raw samples and their recorded source/build/harness hashes are preserved unchanged.

## Environment and provenance

Windows 10.0.26300; Intel(R) Core(TM) i5-10210U CPU @ 1.60GHz; 8 logical cores; 31.8 GiB RAM. Electron 44.7.0; Chromium 152.0.7977.130; Node 24.21.0. Viewport1440×900, text scale1, English/light presentation.

Base commit: `dd2a2734f66f28e7568e1b3a928482fc4e876c44`; dirty candidate: `41709a52bdb80a2ee4c1d7f2ca6000a8b1c176a212d22b0f20eb4ccc1a788c9a`; compiled build: `89025e27738eac94544dbd246a90284d0dea2e84321902bfe5f5b64e415ad007`.

Raw evidence SHA-256: `6634ad12bab2e00463b696fd820697c7a4bd2bff36ecfa649c1bb8cf3e430759`.

[All360 raw samples and measurement configuration](session-loading-2026-11-12-windows.json). Native Ubuntu has not been measured.
