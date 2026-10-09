# UI reference

Layout A, the three-pane workspace of `../architecture/06-ui.md` §1, chosen on 2026-10-09 for being
simple and clear in its menus. These files are a visual reference for the M0–M2 UI work packages,
not a specification: where they differ from 06-ui.md, the spec wins.

Each screen exists as a PNG and as static HTML, in a light and a dark theme (`-light`, `-dark`).
Open the HTML in a browser to inspect sizes and colours.

| Screen | Files | Content |
|---|---|---|
| Session workspace, 1440×900 | `layout-a-workspace-*` | session list with status badges, a turn with tool rows and citation chips, an edit waiting for approval with its diff and `A`/`D` keys, the composer disabled during the wait, the Docs tab with index status |
| Welcome, 1440×900 | `layout-a-welcome-*` | create a workbench (name, folder), open an existing one, the demo link, recent workbenches including a missing folder |
| Settings — Providers, 1440×900 | `layout-a-settings-providers-*` | default model, ChatGPT subscription, OpenAI API key (masked), custom endpoints, a four-step connection test with a failed tool-calling step |
| Settings — Appearance, Language, Updates, 1440×900 | `layout-a-settings-appearance-*` | theme cards, five text sizes, interface language, a downloaded update with mode, channel and release notes |
| Narrow window, 1024×640 | `layout-a-narrow-*` | the right panel opened over the conversation (Changes tab), closed with Esc or the Panel button |

Settings is one page with sections; its left menu jumps between them, and "Back to …" returns to
the workbench the user came from.

Design canvas with the source of these mockups and the two rejected alternatives (B document-first,
C workbench cockpit): https://claude.ai/artifact/Nb6LL9Lknjho2KEzcLkXsC (private to its owner).
