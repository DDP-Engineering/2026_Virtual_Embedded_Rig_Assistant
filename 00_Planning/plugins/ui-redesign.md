# Plugins — catalog discovery and workbench activation

Date: 2026-11-11. Status: accepted planning direction; not implemented.
The user requested that this proposal and its interactive HTML be saved and tracked in Gitea.

Implementation plan: [PLG-23…PLG-25](../plan/plugins-ui-redesign.md).
Tracking: [umbrella #85](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/85),
children #86 (metadata), #87 (global page), #88 (workbench settings/integration).
Interactive reference: [plugins-redesign.html](../ui/plugins-redesign.html), a self-contained file
that opens directly in a browser without a server or network connection.

## 1. Problem and outcome

The current Plugins page combines installed packages, catalog configuration, checkable pack groups
and a detailed catalog list. Default-checked pack groups look like installed or enabled plugins even
when the page says that none are installed. With dozens of plugins, this also creates a long page
without search, filters or sorting.

The replacement must make three independent choices clear:

1. Discover a package and install it in VERA.
2. Prepare its external programs, where necessary.
3. Enable it explicitly for an individual workbench.

Installing or updating never implicitly enables a plugin, provisions its programs or runs a command.
Enabling a plugin never installs programs or runs a command. Existing risk/approval policy remains
authoritative, including the special trial policy and the ordinary bypass policy.

## 2. Navigation and information hierarchy

- **First part of the global page:** a management area before the tabs/list. Keep Install from
  folder…, Install from ZIP…, Check all dependencies, Refresh list and Check for updates directly
  accessible here. Catalog settings (source, URL, Save, Use default) are in this same top area,
  optionally under a disclosure. These capabilities must not disappear or be pushed below the list.
- Retain the sidebar's **Plugins** destination. The prototype's Settings breadcrumb is illustrative;
  this change does not move plugin management into App Settings.
- Two tabs: **Available** / **Disponibile**, and **Installed** / **Instalate**, with total counts.
  Render one plugin list in the selected tab.
- Available presents the active catalog, including the installed state and an Update action where
  relevant. Installed presents packages available on this machine, including local/trial packages
  and applicable workbench-scoped packages. Do not collapse distinct package sources by display name
  or overwrite their trust tier using a catalog match.
- Initially open Available, as in the HTML. Retain the chosen tab and filters while navigating
  within the current application session; no new persisted settings needed.
- Remove the checkable Packs list and Install selected from the primary UI. Keep `packs.yaml` and
  its catalog validation/data contract; this change does not remove ecosystem package definitions
  or introduce another bulk-install mechanism. Existing `default` flags never imply enablement.
- There is **no Configure workbench button** or per-row activation shortcut on the global Plugins
  page. Activation is reached through **Workbench settings → Plugins**. Workbench context comes
  from that navigation, not a selector inside the Plugins section. Do not create a second
  enablement store or a parallel workbench configuration form.

## 3. Search, filters, sorting and pagination

These operations work locally on the loaded snapshot and do not fetch on every keystroke.

| Control | Behavior |
|---|---|
| Search | Case- and diacritic-insensitive matching of name, id, description, ecosystem, activity labels and keywords. Whitespace-separated words all match somewhere in this combined text |
| Ecosystem | Single selection using the catalog/manifest's actual ecosystem values; All is the default |
| Activity | Single selection: communication, flash, build, debug, firmware analysis, measurement, security, version control or testing. Localized labels; a plugin can have multiple activities |
| Provenance | Official/community for catalog entries; include local/trial and applicable scoped-source information in Installed. Labels describe the actual package source |
| State in Available | All, Not installed, Installed, New in catalog, Updates |
| State in Installed | All, Needs configuration, Updates; expose unavailable/broken entries with their diagnostics instead of dropping them |
| Sort | Name A–Z, Recently added, Recently updated; default Recently added in the global library, Name A–Z in the workbench section, with stable id/source tie-breakers |
| Paging | 6, 12 or 24 rows per page; default 6 as in the HTML. Show matched/total count, visible range and previous/next controls |

Combine filters with AND, including search. State-filter counts respect the other active filters.
Tab counts remain the total for that tab. Show a visible Clear filters action when filters are active.
Reset/clamp pagination when a filter, page size or result set changes, so a result cannot disappear
merely because the old page number is now out of range. An empty result offers Clear filters;
an empty Installed view also offers Browse available plugins.

Keep global-library and workbench-editor filters separate. Returning from a workbench retains the
library selection. No popularity/download-count or recommendation sort is planned: there is no
corresponding data source.

## 4. Catalog discovery metadata

The current catalog entry has ecosystem, name and description, but no activity/keyword metadata
or publication dates. The implementation therefore includes the publishing path, not just controls
that sort synthetic renderer data.

Maintain discovery metadata by plugin id in the maintainers' `catalog.yaml`, and carry it into
generated `index.json`, the validated catalog view and bundled catalog resources:

- `activities`: a bounded, unique list of stable activity identifiers from §3;
- `keywords`: bounded plain-text search terms, not executable instructions;
- `addedAt`: optional real calendar date `YYYY-MM-DD`, the first publication in the catalog;
- `updatedAt`: optional real calendar date `YYYY-MM-DD`, publication of the currently listed version.

Dates are maintainer-supplied facts. Do not use file modification times, cache/download times,
installation times, build time or semantic-version strings as substitutes. Omit a genuinely unknown
date; display Date unavailable in details and place undated entries after dated ones. Missing dates
are an intentional valid state, not a reader for an earlier development format. Invalid supplied
metadata fails catalog validation. Reject metadata references to nonexistent plugin ids.

Newest sorts order known dates descending, then name/id/source. New in catalog means a known
`addedAt` within the preceding 30 UTC calendar days, inclusive of today and excluding future dates;
an update alone never marks an established plugin New. The build remains deterministic for identical
inputs. The bundled source populates factual metadata for existing real plugins; the prototype's
fictional dates and future plugin examples must never become production catalog content.

Keep every format/schema version at **1**. Update contracts, generator, fixtures, bundled assets,
CLI output, mocks and documentation together; do not add migrations, backups or legacy readers.
Installed packages outside the catalog remain visible even when discovery metadata is unavailable.
The prototype's individual category assignments and versions are illustrative, not an authoritative
metadata file for the real catalog.

## 5. Rows, details and actions

- Rows show name, one short description, provenance, ecosystem/activity and explicit installation
  state. Detail disclosure contains version, source, dependencies, programs, risk notes and issues.
- Available: Install, or Installed; offer Update when an actual newer catalog version is available.
  Review required dependencies in order and retain the existing hash-bound installation and update
  review. Cancellation and failures do not silently continue the remaining install queue.
- Installed: distinguish Not checked, Needs configuration, Ready and Unavailable/error. Update and
  configuration are separate concerns; an update badge never hides a missing-program problem.
- Configure exposes the existing dependency probes, detected versions/ranges, supported program
  installation, manual archive import and vendor instructions. A find-only SDK such as ESP-IDF
  remains user-managed; a Configure click must not pretend that such an SDK was installed.
- Retain separate top-of-page Install from folder… and Install from ZIP… buttons, native pickers
  and review. Check all dependencies probes the installed scope without installing programs or
  changing enablement; show in-progress/results/partial failures and disable it when nothing can
  be checked. Refresh list refreshes installed state without dropping filters or pagination context.
  Retain confirmation/diagnostics for uninstall, scoped-source review, trial promotion and export.
  Put uncommon actions in details or a menu rather than filling every row with buttons.
- Place Catalog settings (URL, Save, Use default, source information) in the first management area,
  optionally collapsed. Keep Check for updates in this area and preserve bundled/remote/none plus
  unreachable/invalid-catalog messaging. Then render Available/Installed, filters and the list.
- Metadata-only browsing, expanding details and changing filters never provision or execute tools.

## 6. Workbench activation

This section lives at **Workbench settings → Plugins**, as corrected by the user on 2026-11-11.
There is **no workbench selector** and **no Add plugins/Browse catalog button** in this section;
global discovery/installation belongs to the separate Plugins page. Show the current workbench
name as context, never as an editable selector.

Reuse the existing creation/editing draft and Save/Cancel lifecycle. Show only packages available to
that workbench, plus unresolved ids already present in its enabled list, with clear diagnostics.
Keep disabled/invalid, hash-review, read-only and scoped-resolution behavior authoritative.

Checkboxes here mean only **Enabled for this workbench**. Display readiness beside the checkbox;
being installed, enabled and ready are separate facts. A selected plugin with missing programs
shows the problem and Configure, without claiming that it is usable. Invalid/untrusted entries are
not newly selectable; unresolved selected entries can still be removed as the existing editor allows.

Place **Save / Salvează** and **Cancel / Renunță** at the **beginning of the page**, above search,
filters and the list, with selection count and unsaved state. Save becomes enabled when the draft
differs from the saved configuration, and is
disabled again after save/cancel or reverting all edits. Cancel discards unsaved edits through the
existing editor lifecycle; it must not require reaching the bottom of the plugin list.

Save applies the selection to that workbench; Cancel restores the saved selection. Filter/page
changes preserve all draft selections, including hidden rows. Navigation outside this section uses
the editor's existing unsaved-change handling. Returning after an install on the global Plugins
page refreshes installed state and preserves the still-valid editor draft. No cross-workbench
enablement or automatic opt-in.

## 7. Prototype and production boundary

The HTML is a Romanian interactive reference with 32 demonstration entries, including hypothetical
plugins, synthetic dates/versions and initial installed/selected states. It supports combined search
and filters, three sort orders, pagination, detail disclosure, simulated install/configure/update,
and a simulated workbench draft with top-of-page Save/Cancel. An external **Preview** screen switcher
lets reviewers inspect both screens; it is not part of the production Plugins page or a workbench
selector. The prototype downloads, provisions and executes nothing.

Production follows this text when details differ: source-aware rows,
trial/scoped/invalid entries, manual install actions and real unsaved-change navigation belong to
the actual VERA components. Top folder/ZIP actions simulate review with a demonstration local
package rather than reading the user's files. The prototype's simplified Configure and uninstall controls do not
authorize installing vendor SDKs or require a new registry of every workbench on disk. Theme, text
sizes, translations and keyboard patterns use VERA's existing design system.

## 8. Verification and scope boundary

Use [verification-policy.md](../../02_Tools/verification-policy.md): focused checks, static/strict
checks and both independent reviews per implementation ticket; no routine complete suite per child.
Cover at least 30 deterministic fixture entries, search normalization, combined filters/counts,
each sort including unknown dates/ties, page reset, empty/error/offline cases, action cancellation,
and per-workbench Save/Cancel with hidden selections. Verify en/ro/de, light/dark, supported text
sizes, keyboard/focus behavior and the supported desktop window size without horizontal overflow.
Use existing installation/risk proof when unchanged and add focused native IPC acceptance for the
new integration. No hardware action or real irreversible operation is required for this UI change.

Catalog hosting/signing, new real plugins, bulk installation, recommendations/popularity, changes to
execution permissions and compatibility/migration work are outside this proposal.
