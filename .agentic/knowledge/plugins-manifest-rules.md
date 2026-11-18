# Plugin manifest and rules

## Routing

Select for plugin.yaml validation (format 1 fields, limits and issue codes), rule matching, risk
levels, the mode matrix, trial plugins, the confirmation word and the option-syntax helpers. Start at
`05_Software/src/libraries/shared/src/plugins.ts` (schema) or
`05_Software/src/libraries/shared/src/program-rules.ts` (matcher and policy); focused tests sit next to
each. [Plugin store, trust and integrity](plugins-store.md) owns import, review and install of a package;
[Plugin program tools and approvals](plugins-program-tools.md) owns the run_program request and the gate
decisions that apply the policy; [Plugin provisioning and dependency kits](plugins-provisioning.md) owns
install kinds and version probes. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

Shared defines plugin.yaml format 1, the issue codes and the plugin summaries exchanged over IPC.

Shared `program-rules.ts` classifies a command line with the declaring plugin's rules and maps
(permission mode, risk, trial) to a policy; the matcher, policy table and confirmation word are
specified in `.agentic/specs/REQ-FUNC-80b2033a.md`.

## Public interface

- Shared: `pluginManifestSchema`, `validatePluginManifest(data)` → `{manifest?, issues}`,
  `pluginIdSchema`, `pluginRiskSchema`, `pluginTierSchema`, `pluginPlatformSchema`,
  `pluginIssueSchema` (`manifest`, `yaml`, `field`, `id`, `record`, `changed`, `unavailable`, `untrusted`, `collision`),
  `pluginInstalledSchema`, `pluginSummarySchema` (adds `enabled`), `PLUGIN_LIMITS`,
  `isPluginRelativePath`, `pluginMaturity(version)`, `pluginPlatform(platform, arch)` (core re-exports it),
  `pluginHighestRisk(rules)` -> `PluginRunRisk` (`safe` without a rule below `blocked`),
  `pluginOperations(rules)` -> `{risk, rules}[]` (one group per risk with rules, in risk order, rules in manifest
  order and unchanged), `pluginCompositionSchema` (`skills: {name, description?}[]`, `files: string[]`).
- Rules (shared): `classifyCommand(rules, program, args)` -> `{risk, notes, confirm, timeout}` (timeout:
  the largest timeout of the matching rules, or null),
  `programArgumentRefusal(args)` -> `{reason: count|length|control|argument-file, index?}` or null,
  `programPolicy(mode, risk, trial)` -> `run|refuse|mode|user|confirm`, `confirmationMatches(word,
  typed)`, `programCommandLine(program, args)`, `PROGRAM_ARGUMENTS {count 64, length 4096}`,
  `programApprovalSchema` (the event payload) and `validProgramApproval`.
- Manifest `translations` (optional): `ro|de|fr` → `{summary, description}` with the English limits; catalog index
  entries carry it, and shared `pluginText(entry, language)` picks the interface language's texts, else English, for
  catalog cards, the pack chooser, the review and installed rows. Plugin help pages are shown by [Help](help.md).

## Invariants

- The manifest is strict format 1: unknown keys, a second install kind, a version regex without
  exactly one capture group, placeholders other than `${workbench}`/`${pluginDir}` (env) or
  `${pluginDir}` (prefix) are field issues with dotted paths. `id` equals the folder name.
- Matching costs O(pattern tokens × command tokens) per rule (a failed `*` is never retried from a
  later token). Matching lowercases every token, turns `_` into `-` and splits `--name=value` into two tokens, for
  the command and the pattern alike; a pattern must cover the whole command line. All matching rules
  apply, the highest risk wins (blocked > irreversible > device-write > device-read > safe), notes of
  every matching rule are kept once in manifest order, and an unmatched command is device-write.
- Before any rule or file: more than 64 arguments, an argument over 4096 characters, NUL/CR/LF or a
  leading `@` is DENIED with its reason; a program not declared by the plugin is DENIED undeclared.
- The confirmation word of an irreversible command is the token matched by the first non-wildcard
  pattern token after the program in the first matching irreversible rule, else the program name.
  `decide` under policy `confirm` refuses missing or different typed text with INVALID
  `approval.confirmMismatch` (still pending) and refuses `switchToAutoEdit` with INVALID.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Manifest field or limit | `pluginManifestSchema` in shared `plugins.ts` | `shared/src/plugins.test.ts` |
| Git option roles, helpers, listings and destructive escalation | `shared/src/git-options.ts`, `ProgramTools.request`, manifest `optionSyntax: git` | `tests/plugins/git.test.ts` |
| STM32_Programmer_CLI command map (canonical names, displ/<write>, debugauth, <list-only>, <unknown>) | `shared/src/stm32-options.ts`, manifest `optionSyntax: stm32cubeprog` | `tests/plugins/stm32-cubeprog.test.ts` |
| pymcuprog option roles (action, info, protect, high-voltage, locked, unknown) | `shared/src/pymcuprog-options.ts`, manifest `optionSyntax: pymcuprog` | `tests/plugins/microchip-pymcuprog.test.ts` |
| tshark option roles (info, file, capture, unknown, execute, credentials) | `shared/src/tshark-options.ts`, manifest `optionSyntax: tshark` | `tests/plugins/wireshark-tshark.test.ts` |
| Matching, policy table, confirmation word | `shared/src/program-rules.ts` | `shared/src/program-rules.test.ts` |

## Key behaviors

Rule parsing canonicalizes adjacent sequence wildcards to one before whole-command matching; risk, notes, timeout and the first irreversible confirmation word retain their original semantics. The wildcard-heavy regression keeps its existing 300 ms bound.

- `REQ-DATA-4d4471f9` — plugin.yaml format 1 validation with field paths (spec REQ-DATA-4d4471f9.md).
- `REQ-FUNC-5bb9429f` / `REQ-FUNC-80b2033a` — token normalisation and pattern grammar (spec REQ-FUNC-80b2033a.md).
- `REQ-FUNC-2819a97e` / `REQ-FUNC-9ca99463` — highest risk wins; unmatched is device-write.
- `REQ-SEC-28b53f44` — pre-rule argument refusals.
- `REQ-FUNC-8d305364` / `REQ-SEC-94998c85` / `REQ-SEC-2b4bcdf5` — mode matrix, blocked, trial override.
- `REQ-SEC-e8695b28` / `REQ-SEC-08fbf962` / `REQ-SEC-f40ac584` — typed word, mismatch, no switch.

## Files

- `05_Software/src/libraries/shared/src/plugins.ts` — manifest, issue, summary and request schemas; limits.
- `05_Software/src/libraries/shared/src/plugins.test.ts` — manifest validity and field paths.
- `05_Software/src/libraries/shared/src/program-rules.ts` — matcher, refusals, policy, typed word, approval payload schema.
