# Local embedding model indexing on Windows

Measured on 2026-11-19 on the [recorded Windows session-performance host](../2026-11-12-windows-session-loading/NOTES.md).
Windows 10.0.26300, Intel Core i5-10210U, 8 logical processors and 31.8 GiB RAM. Node.js 24.21.0,
local q8 models and CPU inference.

| Model | Median index time | Documents per second | Median peak working set |
| --- | ---: | ---: | ---: |
| BGE Small EN v1.5 | 5.480 s | 4.38 | 333.5 MiB |
| Multilingual E5 Small | 8.415 s | 2.85 | 944.4 MiB |

E5 took 1.54 times as long and used 2.83 times the peak working set on this fixture.

## Method

Built the local CLI with `npm run build:cli` via the pinned Node wrapper. For each run,
`vera index --workbench <isolated folder> --data <isolated app data>` started a fresh process and indexed the
same 24 short synthetic engineering text files, six each in English, Romanian, German and French. Every run
returned 24 indexed documents and stored 24 vectors of the selected model. Elapsed time includes process
startup, document extraction, chunking, embedding and SQLite writes. Working set is the operating system's peak
for the Node process, including its worker threads, observed at 25 ms intervals. Each model ran three times,
with the order reversed in the middle pair. The operating system's file cache was left in its normal state.

| Pair | BGE time | BGE peak | E5 time | E5 peak |
| --- | ---: | ---: | ---: | ---: |
| 1 | 5.763 s | 333.5 MiB | 8.415 s | 944.5 MiB |
| 2 | 5.480 s | 311.3 MiB | 9.958 s | 944.2 MiB |
| 3 | 5.328 s | 363.7 MiB | 7.180 s | 944.4 MiB |

These measurements describe fresh CLI indexing on this fixture and host. The Electron switch reuses persisted
extraction, and its indexing and application-wide memory have a different measurement boundary.
