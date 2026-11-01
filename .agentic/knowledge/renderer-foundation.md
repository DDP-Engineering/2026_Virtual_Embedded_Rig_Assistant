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
Application metadata is displayed in Settings About. F10 focuses the native-menu triggers;
left/right/Home/End move focus and Down or Enter opens the selected native menu.

## Public interface

- App switches Welcome, Settings and session memory routes; Ctrl+, opens Settings while the exact renderer URL stays intact. Global actions yield to modal/handled/repeated/composing keys; the skip-content control focuses main without URL changes.
- Welcome remains mounted in Settings, retaining the active workbench. Create/open, recents,
  read-only/warnings and the keyboard pinned dialog are owned by [workbench](workbench.md).
- Shell supplies resizable/collapsible sidebar and right panel; session Context shows pinned context/skills, Changes presents completed session edits/counts/diffs and reveal through the [Changes](changes.md) component; Docs presents the live document index; Source shows the opened source and recent sources ([document viewer](document-viewer.md)); Artifacts opens/reveals/exports session content; Plan displays current session todos.
  Below1280px the right panel overlays the centre. Tabs expose stable linked panels and a single Tab stop with Left/Right/Home/End activation.
- Settings edits Providers, Light/Dark/System, five scales and System/en/ro/de; Updates presents distribution-specific state/actions; Data retains its placeholder. [Providers](providers.md) owns masked credentials, endpoint forms and consent.
- About renders application name, version, platform, architecture, portable state and system locale
  from strict app.info. Home contains workbench actions and recents. Build/signing labels do not
  appear in the presentation; native packaging owns compiled identity and signature checks.
- usePreferences loads {settings}, applies mutation responses, invalidates on settings.changed
  and cleans up its app subscription. Failure displays localized structured errors and retry.
- System theme follows prefers-color-scheme; root data-theme is light/dark. Main nativeTheme.themeSource
  follows the persisted setting. Root font is14px times scale; geometry and code use rem.
- System language resolves app.info.locale to en/ro/de, otherwise en. All labels/accessibility/error
  text comes from English-source and Romanian/German catalogs.
- lib/layout.ts validates version1 renderer-local geometry. Exact contract:
  [foundation spec](../specs/REQ-UX-4a040001.md).
- check:i18n uses TypeScript AST translation references and finite registered key collections;
  it rejects missing/unused/translation-only keys and arbitrary dynamic calls.

## Invariants

- API authorization, Chromium sandbox and confined vera://app production CSP remain authoritative.
- Application schema/UUID/validation/no-op semantics belong to core/shared. Preferences apply only
  from confirmed snapshots; failed saves retain the preceding state.
- Local geometry uses a strict separate version 1 record with a required source width. Invalid or
  other-version data uses defaults; there is no read-only layout mode. Failed storage stays transient.
- Resizers support pointer drag, arrow keys and Home/End with accessible separator values.
- Keyboard controls use visible focus-ring CSS and semantic labels; opaque theme-token text pairs meet calculated AA contrast. Actual visual/AT acceptance follows the renderer accessibility contract. Selected buttons expose semantic state and heavier type.
  Reduced-motion styles disable animation/transition. The shell is fixed to the viewport with no document scroll; long pages and panels own their internal scroll regions. Minimum viewport uses wrapping inside these bounded regions.
- [Chat UI](chat-ui.md) owns session navigation, transcript, composer, usage and session Context.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Routes/placeholder sections | App.tsx, components/settings.tsx | browser acceptance |
| Panels/geometry | components/shell.tsx, lib/layout.ts | preferences.test.ts and native foundation acceptance |
| Viewport containment and regional scrolling | styles.css, App.tsx | tests/e2e/session-scroll.spec.ts |
| Appearance/theme/scale | hooks/use-preferences.ts, styles/ | native restart plus browser minimum-size matrix |
| Languages/errors | i18n.ts, locales/, lib/language.ts, components/error-message.tsx | catalog fixture and browser translated failure |
| Query invalidation | hooks/use-preferences.ts | native external update and browser save failure |

## Key behaviors

- REQ-UX-4a040001 — shell and memory routes.
- REQ-UX-4a040002 — saved resize/collapse geometry and responsive overlay.
- REQ-UX-4a040003 — saved/system appearance and native theme.
- REQ-UX-4a040004 — five saved scales and rem components/code.
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
- i18n.ts, locales/{en,ro,de}.json — catalog initialization and translated strings.
- styles.css, styles/themes.css — responsive rem geometry, focus and theme token blocks.
- 05_Software/src/apps/desktop/src/main/index.ts — initial and updated nativeTheme.
- 05_Software/scripts/check-i18n.mjs, tests/tooling/i18n.test.ts — AST catalog auditing/fixtures.
- 05_Software/tests/e2e/{mock,shell}.spec.ts — browser and native UI acceptance.
- 05_Software/tests/e2e/session-scroll.spec.ts — fixed document/main bounds, long Settings, update banner, enlarged input and conversation rail in browser/native Electron.

Settings hides the primary New/Open/Plugins actions while its categories are
visible; Back to workbenches restores the previous workbench view. The overview
has one Edit action and its editor hosts instructions and Skills management.
Shared dialogs are centered, including nested Skills dialogs.

PermissionPicker is shared by the session composer and workbench Agent settings. Bypass has a warning marker plus red/bold selected styling; explicit selection shows a centered, localized full-file-access warning with Close/X/Escape and focus restoration. The application suppressBypassWarning preference hides later notices after confirmed checkbox persistence; failed saves retain a visible error/notice. Native warnings are portaled outside the composer form, preserving input ownership. REQ-UX-33b9d601 and REQ-UX-bb147586 attach to permission-picker.test.ts and tests/e2e/bypass.spec.ts.

Workbench Tools uses the canonical shared built-in names and short localized descriptions with native enabled checkboxes. `components/workbench-tools.tsx` presents the list; `workbench-editor.tsx` owns the existing tools.disabled draft and Save/Cancel/read-only lifecycle. Focused proof: workbench-tools.test.ts plus tests/e2e/workbench-navigation.spec.ts and workbench-tools.spec.ts (REQ-UX-0f1a32c4, REQ-FUNC-37261edc).

## Configurable keyboard shortcuts

Settings → Keyboard shortcuts shows searchable command descriptions and individual
key chips with edit/remove, add and default-reset actions. Keystroke search captures
keys without invoking commands. A modal recorder supports Tab, Escape and conflict
feedback. Confirmed app.settings keyboardShortcuts overrides are supplied through
ShortcutContext; absent overrides use shared defaults and empty lists disable a
command. App owns session/workbench/settings navigation; Shell owns panel toggles;
Workspace owns transcript find and composer/model focus. Exact modifiers, IME,
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
