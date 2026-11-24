# Renderer foundation

## Routing

Select for Welcome/App Settings, memory routes, panels, theme, text scale, UI language,
keyboard/contrast and catalog auditing. Start at 05_Software/src/apps/desktop/src/renderer/App.tsx;
focused acceptance is tests/e2e/mock.spec.ts and the foundation test in tests/e2e/shell.spec.ts.
[Application data](app-data.md) owns the settings schema/service;
[desktop shell](desktop-shell.md) owns native window/security;
[software tooling](software-tooling.md) owns verification commands.

[Verification fixtures](demo-onboarding.md) routes the fictional board corpus and PDF sources under tests/fixtures, used by isolated tests and evaluation/smoke harnesses.

## Purpose and boundaries

React supplies the responsive shell, Welcome workbench management and Settings seams. Appearance and Language
edit the existing typed settings API through TanStack Query. Main sets nativeTheme from confirmed
settings. Renderer owns separate UI geometry storage and i18next presentation.

The shell presents one compact title/menu row, with native window controls supplied by main.
Expanded navigation has VERA branding, Home, project/session or settings-section content,
and bottom Settings. A collapsed sidebar retains Home/project/Settings icons and accessible
labels. Project navigation expands the sidebar; Home and Settings remain usable in rail mode.
Application metadata is displayed in Settings About; a Help (?) button beside the right-panel toggle opens the
[Help](help.md) view;
the title bar has File/Edit/View menus and no Help menu. F10 focuses the native-menu triggers;
left/right/Home/End move focus and Down or Enter opens the selected native menu.

## Public interface

The right panel also has [Terminal](terminals.md), with multiple interactive user tabs and per-terminal
agent-read consent. Shell owns configurable openTerminal (Ctrl+Shift+T); terminal input retains shell
keystrokes. xterm/FitAddon views use strict user IPC and CSSOM-generated styles under the existing CSP.

Settings → Web access hosts the existing web-provider configuration and
Interactive Browser installation, progress, cancellation, removal, and the
app and current-workbench switches. [Desktop browser runtime](browser-runtime.md)
owns the browser policy and focused UI acceptance.

Settings → Commands uses `components/command-settings.tsx` and the shared shell setting. Save and
Cancel control a local draft; clearing the field selects automatic resolution. Localized labels,
placeholder and built-in tool description exist in en/ro/de/fr. Shell approvals show literal command,
cwd and executable shell, with Approve/Deny; prefix grants are a separate work package. Focused
component coverage is command-settings.test.ts and session/approval-card.test.ts in all four languages.


- The title bar opens a localized Activity dialog with modal Tab navigation, Escape dismissal and
  focus restoration. It shares the sidebar's operational query and uses the shared pager for unread
  replies. Activating a session uses the dirty editor guard and linked transcript focus.
- App switches Welcome, Settings and session memory routes; Ctrl+, opens Settings while the exact renderer URL stays intact. Global actions yield to modal/handled/repeated/composing keys; the skip-content control focuses main without URL changes.
- Welcome remains mounted in Settings, retaining the active workbench. Create/open, recents,
  read-only/warnings and the keyboard pinned dialog are owned by [workbench](workbench.md).
- Shell supplies resizable/collapsible sidebar and right panel; session Context shows pinned context/skills, Changes presents completed session edits/counts/diffs and reveal through the [Changes](changes.md) component; Docs presents the live document index; documents open as tabs of the chat area beside the Chat tab ([document viewer](document-viewer.md)); Artifacts opens/reveals/exports session content; Plan displays current session todos; Bookmarks (opt-in: `defaultRightPanelTabs` leaves it out of new workbenches and Restore defaults) lists, filters, jumps to and removes current-session bookmarks ([transcript navigation and bookmarks](chat-ui-transcript-navigation.md)); Runs lists the open workbench's plugin program runs with their logs and Stop ([Plugins page and Runs tab](plugins-ui.md)).
  Below1280px the right panel overlays the centre. Tabs expose stable linked panels and a single Tab stop with Left/Right/Home/End activation.
- Settings pages are Providers, Web access, Appearance and language (Light/Dark/System, six interface scales, chat and code text sizes, System/en/ro/de/fr), Commands, Permissions (confirmed delegated Full Access), Notifications, Dictation ([local models, spoken language, recording mode and shortcuts](dictation.md)), Keyboard shortcuts, Updates (distribution-specific state/actions), Data & privacy (four app masking switches with explicit Save/Cancel), Advanced and About. [Providers](providers.md) owns masked credentials, endpoint forms and consent.
- Settings save policy (REQ-UX-032aab57, REQ-UX-6a1c936e, REQ-UX-58a693f3): Appearance, Commands, Notifications, Keyboard shortcuts, Updates, Data & privacy and Advanced render `SettingsPageHeader` (Cancel/Save top right) over `useSettingsDraft`, which drops edits equal to the confirmed value, so a confirmed save clears the draft and a failed one keeps it. Pages report dirty through `Settings dirtyChanged`; App `leaveEditor` and the guarded `setSection` ask Discard/Stay (`projects.discardChanges`) before leaving Settings or switching pages. Appearance edits are previewed through `hooks/appearance-preview.ts`, merged over confirmed values in usePreferences and cleared on unmount. Update actions (check, download, restart) stay immediate. The session Advanced dialog (REQ-UX-8663749f) keeps a draft and sends `session.advanced.set` per changed key only on Save. Its **Compact now** button (`data-action="compact-session"`, REQ-UX-692b8471) calls `session.compact` at once, outside the draft; it is disabled while the session runs, waits for approval or summarizes, shows the outcome as a status line and a refusal as an error. `AdvancedField` renders a switch key as a select Inherit/On/Off whose Inherit option names the inherited state and source (REQ-UX-91d7a481); `advancedFieldValue` keeps only a stored value of the setting's own type. A choice key renders as a select of Inherit and its options (REQ-UX-6a8a987d). The Live timing tooltip reads "Applies right away" and New "Applies to the next terminal, worker, run or opened session". The shared pager (`components/pager.tsx`, REQ-UX-052f5851) starts a list at its own size, else the resolved Rows per page from `hooks/app-advanced.ts`; a size picked in the list stays for that list (REQ-UX-441b5a9d). Providers and Web access keep their own inline actions until SAVE-02.
- About renders a brand band (DDP logo, name, version, license name and Required Notice lines), the application name, version, platform, architecture, portable state and system locale
  from strict app.info, optional runtime versions (Electron, Chromium, Node.js, V8 from AppInfo.runtime), the license text (repo-root LICENSE.txt) and a third-party components table. Home contains workbench actions and recents. Build/signing labels do not
  appear in the presentation; native packaging owns compiled identity and signature checks.
- usePreferences and useSettingsSnapshot share the app.settings query; cancellation-aware reads reject stale completions after newer confirmed data. Mutations cancel older reads before publishing their confirmed snapshot. The owner invalidates on settings.changed
  and cleans up its app subscription. Failure displays localized structured errors and retry.
- System theme follows prefers-color-scheme; root data-theme is light/dark. Main nativeTheme.themeSource
  follows the persisted setting. Root font is14px times scale; geometry and code use rem.
- System language resolves app.info.locale to en/ro/de/fr, otherwise en. All labels/accessibility/error
  text comes from English-source and Romanian/German/French catalogs; dates and numbers format with the interface
  language.
- lib/layout.ts validates version1 renderer-local geometry. Exact contract:
  [foundation spec](../specs/REQ-UX-4a040001.md).
- check:i18n uses TypeScript AST translation references and finite registered key collections;
  it rejects missing/unused/translation-only keys and arbitrary dynamic calls.

Settings → Data & privacy uses privacy-settings.tsx and privacy-controls.tsx. A partial per-area app draft survives background updates and failed saves; only changed areas reach Save. WorkbenchConfigForm → Data & privacy uses workbench-privacy.tsx with the same confirmed query, live Default (On/Off) labels and the owner config draft. Editor/create Save includes privacy; Cancel never writes it. Read-only controls stay disabled. Core createMaskingResolver remains the policy authority; renderer labels use shared maskingDefaults.

Agent and model effective on→off selections open a portaled native disclosure dialog. This includes explicit On→Default when the app agent value is false. Confirm changes only the draft; Cancel/Escape preserves choice and restores opener focus. Other areas and Default resolving on do not prompt. No helper text appears below controls. Focused proof: privacy-settings.test.ts, workbench-privacy.test.ts, hooks/use-preferences.test.ts and native tests/e2e/privacy-settings.spec.ts in en/ro/de/fr.

## Invariants

- API authorization, Chromium sandbox and confined vera://app production CSP remain authoritative.
- Application schema/UUID/validation/no-op semantics belong to core/shared. Preferences apply only
  from confirmed snapshots; failed saves retain the preceding state.
- Local geometry uses a strict separate version 1 record (sidebar and right widths, collapsed states). Invalid or
  other-version data uses defaults; there is no read-only layout mode. Failed storage stays transient.
- Resizers support pointer drag, arrow keys and Home/End with accessible separator values; side panels resize up to half the window (lib/layout.ts max 200 rem, CSS 50vw).
- Keyboard controls use visible focus-ring CSS and semantic labels; opaque theme-token text pairs meet calculated AA contrast. Actual visual/AT acceptance follows the renderer accessibility contract. Selected buttons expose semantic state and heavier type.
  Reduced-motion styles disable animation/transition. The shell is fixed to the viewport with no document scroll; long pages and panels own their internal scroll regions. Minimum viewport uses wrapping inside these bounded regions.
- [Chat UI](chat-ui.md) owns session navigation, transcript, composer, usage and session Context.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Routes and settings sections | App.tsx, components/settings.tsx | browser acceptance |
| Notification preferences | components/notification-settings.tsx, shared settings contract | notification-settings.spec.ts and native settings restart |
| In-app Activity | components/activity-view.tsx, hooks/use-session-activity.ts, App.tsx | background-sessions.spec.ts and session-question.spec.ts |
| Panels/geometry | components/shell.tsx, lib/layout.ts | preferences.test.ts and native foundation acceptance |
| Viewport containment and regional scrolling | styles.css, App.tsx | tests/e2e/session-scroll.spec.ts |
| Appearance/theme/scale | hooks/use-preferences.ts, styles/ | native restart plus browser minimum-size matrix |
| Languages/errors | i18n.ts, locales/, lib/language.ts, components/error-message.tsx | catalog fixture and browser translated failure |
| Query invalidation | hooks/use-preferences.ts | native external update and browser save failure |

## Key behaviors

- REQ-UX-f7a53a4c — four localized Notifications panels render the same labeled select and switch.
- REQ-UX-a57996c8 / REQ-UX-65f41205 — app/workbench privacy drafts and inherited labels.
- REQ-SEC-01bc890a / REQ-REL-53b7d5ce — agent-off draft confirmation and stale-read/draft protection.

- REQ-UX-4a040001 — shell and memory routes.
- REQ-UX-4a040002 — saved resize/collapse geometry and responsive overlay.
- REQ-UX-4a040003 — saved/system appearance and native theme.
- REQ-UX-4a040004 — six saved scales and rem components/code.
- REQ-UX-4a040005 — UI language and structured error translations.
- REQ-TEST-4a040006 — English usage and translation catalog completeness.
- REQ-UX-4a040007 — keyboard/focus/contrast/reduced-motion/minimum-size accessibility.
- REQ-UX-52f83eb7 — modal-aware shortcuts and accessible transcript search.
- REQ-UX-b7eabce7 — source-consistent Romanian/German catalog semantics.
- REQ-UX-4a040008 — confirmed snapshots and settings.changed invalidation.
- REQ-UX-7c3fd9a6 — fixed viewport and internally scrollable page/panel content.

The view consumes confirmed settings. Native theme and renderer geometry have distinct owners.

## Files

Paths relative to 05_Software/src/apps/desktop/src/renderer except qualified paths.

- App.tsx — memory routes, metadata/query status and Ctrl+,.
- components/{shell,settings,metadata,error-message,workbench,workbench-editor}.tsx — panels, editors, labels and safe error text.
- hooks/use-preferences.ts — Query lifecycle and theme/scale/language application.
- lib/{layout,language}.ts and lib/preferences.test.ts — geometry storage and locale resolution.
- lib/shortcuts.ts — modal/composition/modifier/repeat guard for global keyboard actions.
- i18n.ts, locales/{en,ro,de,fr}.json — catalog initialization and translated strings.
- styles.css, styles/themes.css — responsive rem geometry, focus and theme token blocks.
- 05_Software/src/apps/desktop/src/main/index.ts — initial and updated nativeTheme.
- 02_Tools/build/check-i18n.mjs, tests/tooling/i18n.test.ts — AST catalog auditing/fixtures.
- 05_Software/tests/e2e/{mock,shell}.spec.ts — browser and native UI acceptance.
- 05_Software/tests/e2e/session-scroll.spec.ts — fixed document/main bounds, long Settings, update banner, enlarged input and conversation rail in browser/native Electron.

Settings hides the primary New/Open/Plugins actions while its categories are
visible; Back to workbenches restores the previous workbench view. The overview
has one Edit action and its editor hosts instructions and Skills management. Global Plugins is a reversible installation detour: App keeps that same editor owner mounted but hidden/inert, resumes its section/config/instructions when the active workbench row is chosen, and retains discard guards for actual departures. The hidden editor unmounts only plugin presentation to avoid duplicate library controls; private per-workbench view state restores on fresh list loading (REQ-UX-e5d617d7).
Shared dialogs are centered, including nested Skills dialogs.

PermissionPicker is shared by the session composer and workbench Agent settings. Choosing a Bypass change opens one centered en/ro/de/fr confirmation before changing mode, naming read/change/run in any OS-accessible folder and application-data exclusion. Confirm awaits the save; Cancel/Escape keeps the prior mode, with focus restored to the picker. Save failures stay visible in the dialog for retry/cancel and pending saves prevent duplicates. Bypass retains its warning marker and red/bold styling. Native dialogs are portaled outside the composer form. Given workbenchId, the same dialog lists fresh irreversible rules of enabled, issue-free, non-trial plugins; a list failure still shows the confirmation (REQ-UX-12185f60). REQ-UX-33b9d601 and REQ-UX-bb147586 attach to permission-picker.test.ts and tests/e2e/bypass.spec.ts.

Workbench Tools uses the canonical shared built-in names and short localized descriptions with native enabled checkboxes. `components/workbench-tools.tsx` presents the list; `workbench-editor.tsx` owns the existing tools.disabled draft and Save/Cancel/read-only lifecycle. Focused proof: workbench-tools.test.ts plus tests/e2e/workbench-navigation.spec.ts and workbench-tools.spec.ts (REQ-UX-0f1a32c4, REQ-FUNC-37261edc).

## Configurable keyboard shortcuts

Settings → Keyboard shortcuts shows searchable command descriptions and individual
key chips with edit/remove, add and default-reset actions. Keystroke search captures
keys without invoking commands. A modal recorder supports Tab, Escape and conflict
feedback. Confirmed app.settings keyboardShortcuts overrides are supplied through
ShortcutContext; absent overrides use shared defaults and empty lists disable a
command. App owns session/workbench/settings navigation; Shell owns panel toggles;
Workspace owns transcript find and composer/model focus. The composer dispatches the unassigned-by-default Dictate command while Chat is active. The Dictation page shares the recorder and conflict registry with Keyboard shortcuts. Saving in the Dictation recorder returns keyboard focus to its local command heading while the settings patch is pending. TranscriptNavigator owns next/previous bookmark commands through use-bookmark-navigation.ts; shared defaults are Mod+Alt+N/P and the same Settings editor can edit/remove/reset both commands. Labels and generated help exist in en/ro/de/fr. Exact modifiers, IME,
AltGr, repeats, handled events, dialogs and recording guards retain input ownership.
Native editing/window/developer combinations are reserved; Enter/Shift+Enter/Escape
retain existing contextual behavior. See shared keyboard-shortcuts.ts and
renderer components/keyboard-shortcuts.tsx, lib/shortcuts.ts. Focused verification:
shared/core settings persistence, shortcuts/workspace/shell tests and
 tests/e2e/keyboard-shortcuts.spec.ts (browser and compiled native restart).

Shortcut digits/comma/slash use physical code positions when supplied (letters
follow the current layout key). Windows input without code normalizes standard
shifted symbols to their base keys; recorder feedback rejects unsupported keys.
Key-search activation focuses its input before the next key can execute a command.

Settings includes a separately mounted Web access section. Its global checkbox, Exa/Tavily/Brave selector and capability-aware authentication choice, non-prefilled provider-specific password cleared on switching and inline save/test/remove actions use dedicated IPC. Connection results stay in a centered translated modal with one Close button and restored focus; stale/cancelled results cannot reopen it. en/ro/de labels, consent and native screenshot geometry are verified. See [web access](web-search.md).
