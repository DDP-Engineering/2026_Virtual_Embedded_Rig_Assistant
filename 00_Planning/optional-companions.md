# Optional desktop pets for VERA

Status: proposed optional extension after the current implementation and its final validation.
Date: 2026-10-11.

VERA can offer selectable animated desktop pets, following the interaction model of the Codex
desktop pet shown by the user. A pet is a small expressive character with a transparent background,
which can float above application windows. Its appearance and animation reflect VERA activity.
The catalog contains original characters inspired by electronics, embedded development, testing,
automotive systems and PLC automation. PCB is one selectable character.

This extension is outside the current M0–M5 implementation cycle. It adds no work package,
dependency or acceptance condition to [the existing plan](plan/README.md). Implementation starts
only through a separate later request. The current implementation agent continues its existing
scope. This document records the proposal and does not authorize implementation.

## Verified reference: the installed Codex desktop pet

Reference checked on 2026-10-11 through the user's screenshot, official documentation and read-only
inspection of the installed application's packaged JavaScript and asset index.

The [official desktop pets documentation](https://learn.chatgpt.com/docs/pets) describes selectable
floating pets, show/hide controls, dragging, size adjustment, persisted selection and position,
and reduced-motion still frames. It also describes an activity tray for multiple chats, with
priority: needs input, blocked, ready, running. Its desktop behavior is distinct from the web pet.

The installed Windows package is `OpenAI.Codex_26.1007.2314.0_x64__2p2nqsd0c76g0`. Its internal
`package.json` identifies `openai-codex-electron`, version `26.1007.21434`. Inspection of
`app/resources/app.asar` confirmed these implementation details in that build:

| Area | Observed mechanism |
|---|---|
| Desktop host | Main-process avatar overlay manager creates a transparent, frameless auxiliary window through the window manager, with an `/avatar-overlay` route, initially unfocused, and sets the floating always-on-top mode. |
| Pointer handling | The overlay manager switches mouse passthrough and interactive hit regions, allowing the surrounding desktop to remain usable. |
| Position | The manager restores and saves position information, including display and resolution records. |
| Selection and artwork | A built-in catalog maps pet identifiers to bundled WebP sprite sheets; the inspected asset map contains nine built-in entries. |
| Animation player | A React component changes CSS `backgroundPosition` to select a sprite frame. Timers use frame-specific durations, with loop behavior and a reduced-motion single-frame path. |
| Animation vocabulary | The inspected player defines idle, running, waiting, failed, review, waving, jumping, running-left and running-right clips. These are animation names, not nine separate task statuses. |

Evidence locations inside the installed archive:

- `.vite/build/main-BklS_2Y2.js`: overlay lifecycle, window creation, pointer policy and persistence.
- `webview/assets/app-initial-b8e1c8014bb4.js`: sprite catalog, clip definitions and frame player.
- `webview/assets/avatar-overlay-native-page-c254d4864d6b.js`: overlay renderer and activity UI.
- `webview/assets/pets-settings-route-e27382d38a82.js`: pet selection and size controls.

This is an observation of a compiled installed build, not an audit of OpenAI's original source
repository. Bundle names and internal formats may change. VERA should reproduce the interaction
concept with its own characters and implementation; it does not need Codex artwork, code or exact
sprite dimensions.

The earlier PCB activity-strip mockup illustrated lighting effects only. It does not define the
requested desktop-pet experience. The proposal below supersedes that placement and the earlier
abstract-only catalog.

## User experience

Settings gains a Pets section with visibility, a character picker, size, position reset and motion
controls. Entries have a translated name, preview and accessible description. Users can preview
the activity animations before selecting a pet. Several pets are available; one is active at a
time. Selection changes the character without changing the session, permission mode or agent.

The pet lives in a small transparent desktop overlay. Its default position is near a screen edge,
where it can resemble the user's Codex example. Users can drag it, adjust its size, hide it and
restore it from VERA. Selection, visibility, size and position survive restart. If a saved monitor
is disconnected, the pet returns to a visible location on an available display.

The pet should remain visible while the user works in another application, without repeatedly
taking keyboard focus. Only its visible character and controls intercept pointer input; empty
overlay space passes input through. Opening the picker or using keyboard controls is an explicit
interaction. Dragging must be distinguishable from clicking.

A compact activity control identifies the session behind the displayed state and opens that
session in the main VERA window. Approval actions remain in the established approval interface.
The transcript, status text and Stop control remain usable with pets disabled. A pet cannot be
the only way to discover an approval or an error.

Quick-chat entry, voice, global shortcuts, a custom-pet creator and a remote gallery are optional
later additions. Matching the selectable animated desktop pet does not require bringing these
other Codex features into the first VERA pet release.

## Candidate character catalog

These are original mascot candidates. Final artwork and the shipped selection are decided when
the later work is scoped. The release must contain multiple selectable characters, including PCB.

| Pet | Domain | Character and effects |
|---|---|---|
| PCB Buddy | Electronics | A small PCB character with a chip face, tiny feet and illuminated traces. Light packets travel around its body while working. |
| MCU Bot | Embedded firmware | A microcontroller robot with pin-like arms. Its display shows brief original code or register motifs, and its pins light up during activity. |
| Scope Buddy | Signals and debugging | A miniature oscilloscope character whose screen draws a waveform. Its expression and trace shape change with the activity state. |
| Probe Bot | Testing and validation | A small test-probe robot with two leads and a status lamp. It inspects a fictional test point while a tool runs. |
| ECU Rover | Automotive embedded | A compact ECU character with connector details and CAN-inspired light packets. Wheels or feet give it a readable idle and working pose. |
| PLC Buddy | Industrial automation | A small PLC character with terminal blocks, I/O indicators and a ladder motif on its face or display. |

Current lines, lightning, PCB traces, Matrix-like code and ladder effects can decorate these
characters. Each pet retains a recognizable silhouette, personality and expressive poses at a
small size. Effects represent software activity; they are not live current, bus traffic, physical
I/O or proof of successful hardware testing.

## Shared activity states and animation clips

All characters express the same activity meanings with their own artwork. Idle motion, a greeting
or a click reaction are additional character behaviors, separate from task status.

| State | Meaning | Example for PCB Buddy |
|---|---|---|
| Idle | No active turn or pending decision in the represented session. | Breathing pose, blinking chip face and a slow LED pulse. |
| Working | A turn is running. | Focused pose with light packets converging on the chip. |
| Tool active | One or more tools are executing. | The character leans toward a trace carrying a repeating packet flow. |
| Needs input | An approval or another supported user decision is pending. | Waiting pose, raised pin-hand and a paused packet near a node. |
| Completed | A newly observed turn finished normally. | Brief happy pose and an outward light pulse, then idle. |
| Error | The turn failed or the session has a terminal error. | Concerned pose, a stalled packet and a distinguishable error mark. |

"Working" reports observable runtime activity, without claiming knowledge of internal reasoning.
Cancellation, restart interruption and a refused edit do not trigger a success animation.
A recoverable tool failure does not automatically turn an otherwise active session into a terminal
error. The completion cue does not imply that all hardware tests passed.

The proposed activity adapter retains the source session ID. If several sessions have activity,
use the Codex-inspired order: needs input, terminal error, newly completed unread activity,
running, idle. Within a priority, prefer the foreground session, then the most recently updated
session. The activity control makes that choice visible. The later design must confirm how VERA
records acknowledgment of completion; old or replayed completions must not become fresh alerts.

## Integration with the architecture after the current implementation

The planned [process and IPC boundary](architecture/01-system.md#3-processes-and-the-ipc-boundary)
and [session event contract](architecture/03-agent-and-tools.md#8-session-events) provide the
starting point. A desktop pet needs an additional main-managed window and a restricted IPC surface;
it is a future shell extension as well as a renderer feature.

Proposed flow:

`session snapshots/events → shared session state → activity adapter → pet snapshot → overlay renderer`

| Responsibility | Proposed owner |
|---|---|
| Agent execution and authoritative session events | Existing core services; no pet-specific model calls. |
| State derivation and priority | A shared pure adapter over the existing session reducer, hosted by the desktop activity owner. |
| Window lifecycle, display placement, pointer policy and focus | Desktop main process. |
| Pet settings, catalog IDs and validated snapshot types | Shared schemas, with persistence through the existing settings service. |
| Narrow communication with the overlay | Preload bridge and main IPC router, with sender checks and zod validation. |
| Sprite playback, character effects and accessible controls | Overlay React renderer. |

The main process creates the pet window explicitly. The existing denial of renderer-created
`window.open` calls remains the intended policy. The future router must recognize only registered
VERA windows and restrict the pet renderer to the operations it needs. The overlay has no Node,
filesystem, credential or tool access. Any architecture decisions are recorded when that later
implementation is scoped; this proposal does not change the current architecture documents.

Use an activity feed owned independently of the foreground transcript component so the pet can
continue to reflect running sessions when VERA's main window is hidden. Reuse the existing event
and snapshot services, rather than adding a second agent loop or polling a model. Send compact
activity snapshots only when meaningful state changes. Animation frames stay local to the overlay
and produce no IPC traffic.

State derivation uses `turn.started`, active tool calls tracked by call ID, unresolved approvals,
`turn.done.stopReason` and terminal errors. Snapshot recovery, ordered events and sequence handling
must prevent stale sessions and historical replay from triggering new completion effects.
The adapter must be scoped against the delivered contracts; planned event names are not evidence
that all of these services already exist in the current implementation.

## Artwork and rendering

A bundled transparent sprite sheet per character is the proposed baseline, following the verified
Codex technique. Each catalog entry has a stable ID, translated name, description, preview and
animation manifest. The manifest defines frame rectangles, duration and looping or one-shot
behavior for each clip. All pets implement the required shared states.

Sprite playback can change a CSS background position without a full React render per frame.
Small SVG or Canvas overlays can add trace lights or waveforms if needed. The final renderer and
asset dimensions are chosen for VERA's supported sizes and display scaling. Codex's sheet format
is a reference, not a dependency or required VERA file format.

Assets ship with the desktop package and work offline. No downloads, model requests, credentials
or local preview server are needed at runtime. Switching characters releases the previous player.
Timers stop when the pet is hidden, disabled, static, suspended or unmounted, then resume from
current state. The lifecycle cannot stop an agent or alter a session subscription.

## Preferences and accessibility

Proposed settings are visibility, selected pet ID, size, display position and motion mode. Initial
defaults are disabled visibility, PCB Buddy selected and motion following the system preference.
The later implementation confirms those defaults and supplies required settings migrations.
An unavailable character ID falls back to a bundled default, without resetting other preferences.

Motion modes are System, Animated and Static. System honors reduced motion. Animated requires an
explicit feature-level choice. Static uses a representative frame with a readable activity label;
it must preserve the meaning of each state. Avoid rapid flashes. Screen readers announce meaningful
state changes, not frame changes.

Selection, show/hide, size and position reset support keyboard access and visible focus. Provide
a keyboard alternative to dragging. Text uses the existing English, Romanian and German catalogs.
Artwork works on light and dark backgrounds at supported display scales. State meanings use text,
shape or pose as well as color.

## Verification for a later implementation

The later work should demonstrate the following before delivery:

- Multiple original characters are selectable, with one active pet and persistent selection.
- Every shipped pet represents all activity states, including useful static frames.
- Show/hide, dragging, resizing and reset work; monitor removal and display scaling restore a
  visible position without taking focus during passive animation.
- Transparent empty regions do not block other applications, while character controls remain
  usable with pointer and keyboard input.
- The overlay reflects activity while the main VERA window is hidden, and opens the correct session.
- Concurrent tools, approvals, handled tool failures, cancellation, terminal errors, session
  switching and restart recovery produce correct states. Replay never generates fresh success.
- Preferences survive restart and schema migrations. Unsupported saved IDs recover cleanly.
- Hidden or disabled pets release animation work; switching pets leaves no timers or listeners.
- The separate renderer preserves the existing IPC and process boundaries and works offline with
  bundled assets. Automated session checks use fixtures or replay, without a real model.
- Window transparency, stacking, pointer passthrough, focus and display restoration are checked
  on VERA's supported Windows and Linux environments before promising identical desktop behavior.

The first later technical spike should validate the native overlay behavior on those platforms.
Any platform limitation and proposed fallback are documented before implementation scope is
accepted. This research does not establish that Codex's Windows/macOS behavior transfers unchanged
to every Linux window manager.

The current work packages, production code, architecture documents and implementation assignments
remain outside the scope of this document.
