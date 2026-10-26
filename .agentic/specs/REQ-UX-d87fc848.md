# Compact desktop chrome and navigation

## Behavior

One draggable title/menu row replaces separate native title/menu and renderer branding rows.
Main exposes native Windows/Linux window controls through the native overlay, reserving
its safe area. Menus are File/Edit/View/Help; native fixed role templates own commands.
Header additionally holds sidebar and right-panel toggles. Native close semantics persist.

Expanded navigation has VERA branding, Home, existing project/session or settings-section
navigation, and bottom Settings. Collapse retains an icon rail with Home, project navigation
and Settings. Project action expands navigation and returns to the workbench page. Stored
collapse and widths retain existing layout version1 semantics; no migrations or fallbacks.
Home contains workbench actions and recents. Settings About contains the application metadata.

## Data / interface

window.menu request: strict { menu: file|edit|view|help, x: integer0..32767,
y: integer0..32767 }; response strict {}. Coordinates are window-local popup anchor positions.
Main clamps coordinates to content bounds and accepts only the existing authorized main
renderer frame. A missing/destroyed window returns NOT_FOUND. Unknown keys/roles fail INVALID.
Browser mock acknowledges this native-only operation; ordinary browser previews retain
navigation and layout behavior. Native popup labels/keyboard commands follow host roles.

## Acceptance

Native launch shows one compact row and native controls. Header controls fit outside native
control area; body starts below it. Menu requests reject untrusted frames/roles/templates.
Mouse/keyboard toggles preserve rail actions and independent right panel. Restart retains
collapsed state. en/ro/de, light/dark and five supported scales fit1024x640 with scrollable
main content and reachable Settings. Geometry and close persistence/security remain intact.
Home metadata is absent; About renders available metadata. No historical journal edits.

## Assumptions and open decisions

The user selected the first displayed design with the rail from the third. Existing brand,
fonts/colors, project lifecycle, credentials and update semantics are retained. No open decision.
