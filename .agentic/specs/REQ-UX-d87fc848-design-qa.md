# Compact shell design QA

Task: TASK-82ff615b. Result: passed, 2026-10-26.

## Target and evidence

Selected composition: concept 1 unified title/menu row and expanded sidebar, combined with concept 3 icon rail. References are the supplied exec-8e2d03a7-b8f7-469c-a8af-829410c5a22b.png (1712x919) and exec-a5f0c0d9-bb04-488f-9f10-64c304cf8473.png (1715x917) under the conversation generated_images directory.

Actual native Playwright captures: C:/Users/pasar/AppData/Local/Temp/vera-compact-TASK-82ff615b/{expanded,rail}.png. Captures at Windows DPI were normalized proportionally to reference widths1712/1715 for inspection; no cropping or stretching. Screenshots are temporary verification data outside the repository; automated approval review blocked scratch cleanup, so they remain there after inspection. Fresh isolated profile, light theme, English, default scale, Home empty state. Native OS caption controls are outside the page capture; separately inspected through the real Windows accessibility tree and window screenshot.

## Inspection

Full views and focused titlebar/sidebar/content regions checked against both selected references. Typography retains existing system UI and scale settings; menu labels and semantic headings remain readable. Layout has one40px default title/menu row, safe native-control area, full-width Home, expanded navigation or compact rail, and Settings anchored at the bottom. Spacing removes the old redundant header and application-information panel. Existing teal/neutral light and dark tokens and Lucide icons are reused; icons remain crisp and named for assistive technology. Copy preserves real workbench terminology and .vera/workbench.yaml; no invented project content. About information is available in Settings.

Initial comparison found redundant bordered creation/open cards relative to concept1; corrected to unframed aligned forms and a teal enabled primary action. Final review found no outstanding P0/P1/P2 visual issues. This is the selected composition adapted to existing product typography, resizable sidebar widths and actual data states, rather than a pixel replica of illustrative content.

## Interaction and acceptance

Windows actual dev window: native File popup opened and dismissed with Escape; sidebar collapsed to rail; native maximize changed to Restore, with minimize/close present. App left open maximized with rail. Automated native tests cover restart persistence, metadata placement, geometry restoration, security and HMR; browser matrix checks en/ro/de, light/dark and all five text scales at1024x640, including rail visibility and keyboard expansion. Ubuntu native tests pass under an isolated real JWM/Xvfb window manager, including maximize/restore and geometry restart. No page errors or non-loopback requests in acceptance.

No new imagery, assets, dependencies or project-data changes. Historical journals remain unchanged.
