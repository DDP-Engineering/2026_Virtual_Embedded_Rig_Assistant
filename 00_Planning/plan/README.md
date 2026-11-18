# VERA implementation plan

Open plans and the delivered plans still kept as files are listed here. What the code does is in
`../architecture/`; decisions are in `../decisions/`. Earlier delivered plans (M0–M5 with
WP-01…WP-38, ELEC, LAB, IOT, PERF-01, CHAT-NAV-01, REPO-01, PLG-23…25) were removed once merged into
`master`; their text is in Git history and their tickets in Gitea.

## Open plans

- Images in the chat: [chat-images.md](chat-images.md), **IMG-01…IMG-05** — paste or attach images for models
  that see images, an image capability per model, and a `view_image` tool for the agent.
- Multilingual embeddings: [multilingual-embeddings.md](multilingual-embeddings.md), **EMB-01…EMB-04** — Multilingual
  E5 Small as a second local embedding model chosen per workbench, BGE Small EN staying the default.
- Further plugins: [../plugins/plan.md](../plugins/plan.md); analysis capabilities:
  [../capabilities/README.md](../capabilities/README.md).

## Delivered plans

- Shell commands and terminal: [terminal.md](terminal.md), **TERM-01…TERM-05 #312…#316 / epic #311** —
  agent shell commands, approvals, additional folders, Runs integration and the user's terminal.
- Bypass scope: [bypass.md](bypass.md), **BYP-03 #308, BYP-01 #309, BYP-02 #310 / epic #307** —
  all agent path tools outside the workbench in Bypass, with application data refused in every mode.
- Delivery packages: [delivery.md](delivery.md), **DEL-01…DEL-06** — VERA for Windows and Linux and
  the plugins as separate deliverables in `07_Delivery`, built by scripts in `02_Tools/delivery/`.
- File lister: [file-viewer.md](file-viewer.md), **VIEW-01…VIEW-06** — any workbench file in Text (word
  wrap, encodings), Hex or Rendered mode, large files read in byte windows, image preview.
- Secret masking: [secret-masking.md](secret-masking.md), **MASK-01…MASK-05** — masking of stored secrets
  set per area (Display, Program runs, Agent and model, Artifacts and exports) as app defaults and per workbench.
- Chat bookmarks: [chat-bookmarks.md](chat-bookmarks.md), **BKM-01…BKM-03** — bookmarks on user messages,
  set from the message or the conversation rail's preview card, shown on the rail, next/previous shortcuts.
- Indexing limits: [indexing-limits.md](indexing-limits.md), **IDX-01…IDX-04** — `.gitignore` honored by
  default, maximum file size and indexed-file count per workbench, one selection for preview and indexing.
- Help and French: [help.md](help.md), **HELP-01…HELP-08** — help pages for VERA and every plugin in
  en, ro, de and fr (`05_Software/help/`), a Help button in place of the top-bar About button, French
  in the interface, and a `help` tool for the agent.
- Plugin management: [plugin-management.md](plugin-management.md), **PLG-01…PLG-08 #262…#269 / epic
  [#261](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/261)**
  (IDs reused from the first plugin epic, so always cited with their issue number), merged into
  `master` as PR #272; its open proofs are below.
- Electrical power and distribution: [electrical-power.md](electrical-power.md), **PWR-00…PWR-06
  #126…#132 / epic [#122](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/122)**
  — common project model, industrial catalog, network and cable sizing, protection, motors and
  drives, reactive power compensation and lighting, merged into `master` as PR #273.

## Deferred by the user

- Upgrade and migration safety (former WP-32) until the first public release; until then every
  persisted format stays at version 1 with no migrations.
- Performance regression references and gates (#91): only measurement exists
  (`npm run perf:sessions`, [results](../../06_SoftwareDocu/session-performance.md)). Startup,
  Plugins and indexing benchmarks are later scope.
- Human review of the `ro`/`de` translations is not recorded.
- `supportsTools` from the connection test is recorded but no UI warning uses it.

## Open proofs

Evidence so far is Windows (and WSL where noted) with simulated or fake devices. Each item stays
open until it is shown on the real thing.

- **Release:** clean offline Windows install, release-artifact update through the updater, Windows
  pktmon egress evidence.
- **Native Ubuntu x64:** the focused tests of every ELEC, LAB and IOT plugin and of CHAT-NAV-01 (the
  `REQ-PLAT-*` requirements); WSL evidence does not replace them.
- **ELEC:** live supplier probes for parts search (no credential provided); the integrated
  acceptance E07-G beyond the golden path.
- **LAB** (real instruments and boards): LAB-01 instruments and the vendor VISA backend; LAB-02 a
  real capture against a real simulation; LAB-03 a real board with probe-rs/esptool; LAB-04 board and
  probe, both profiles `unverified`; LAB-05 a Joulescope JS220, reference load and sleep/wake board;
  LAB-06 firmware other than the fixtures; LAB-07 a real board; LAB-08 a real board, OpenOCD through
  PlatformIO and test-device.
- **IOT** (no board, adapter, radio, Pi or Wokwi token used yet): Arduino upload, serial readback and
  two-board handoff; real MicroPython and CircuitPython boards and the Adafruit bundle download; Bus
  Pirate 5/6 with I2C and SPI fixtures; a product MQTT broker and device; a BLE fixture with read,
  notify, write and pairing; a Wokwi cloud run (needs a token and the user's approval); a Raspberry Pi
  reached over SSH from Windows and Ubuntu.

The opt-in real-tool variables for these runs are in `.agentic/context/environment.md`.
