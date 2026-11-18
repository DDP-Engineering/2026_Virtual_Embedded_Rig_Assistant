# Plugin configuration and credentials

## Routing

Select for declared parameters (`settings`), the plugin page's Configuration section and Needs
configuration, plugin credentials (the `credentials` declaration, the stdin hand-off, the MQTT and Wokwi
forms, the CLI environment variables) and the SSH agent socket. Start at shared `plugin-settings.ts` and
`plugin-credentials.ts`, core `plugins/configuration.ts`, desktop `main/plugin-credentials.ts` and renderer
`plugin-configuration.tsx`. [Plugin program tools and approvals](plugins-program-tools.md) owns the
run_program prepare and apply steps that read a credential; [Plugins page and Runs tab](plugins-ui.md)
owns the status block that shows Needs configuration. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

Plugin credentials (spec REQ-DATA-96d18686 §1): a program that declares `credentials {option, scope}` (scope `mqtt`
or `wokwi`) receives the stored credential `<scope>:<ref>` a call names with `option`, as one JSON line on stdin, and
nothing else does.
Prepare refuses a plugin that is not official, a host without `ProgramHost.credentials`, a repeated option, an invalid
reference or a credential that is not stored; apply loads the enabled plugins again (a disabled plugin is undeclared and
nothing is read), reads the credential and passes it as `RunRequest.input`; a not-stored message names the plugin's
Configuration on the Plugins page and the CLI variable. Desktop main stores the credentials through one
`PluginCredentialService(scope)` (`apps/desktop/src/main/plugin-credentials.ts`): the MQTT credentials form
(`mqtt.credentials.*` IPC: reference, optional username, password) and the Wokwi tokens form (`wokwi.credentials.*`:
reference and token, no username), both rendered by `renderer/components/plugin-credentials.tsx` inside the
Configuration section of mqtt-tools and wokwi (with Replace, which puts a stored reference into the form); each list
returns only its own scope's references and storage. The CLI (`apps/cli/src/plugin-credentials-env.ts`) takes `VERA_MQTT_PASSWORD_<REF>`/`VERA_MQTT_USERNAME_<REF>`
and `VERA_WOKWI_TOKEN_<REF>` into memory-only entries. Schemas live in `shared/src/plugin-credentials.ts`. Neither
changes a program's environment; only the wokwi helper itself puts the token into the one wokwi-cli child it starts.

Declared parameters (REQ-DATA-af8807e1, REQ-FUNC-cbdb46ac, REQ-UX-efe126c0, REQ-UX-05e0ed17): plugin.yaml `settings`
(optional, at most 32; shared `plugin-settings.ts`) names each parameter with a description - `secret` + scope (mqtt,
wokwi, parts), `workbench-file` + workbench-relative path (`*` = one folder level, dot folders skipped, 64 matches),
optional `format` (`lab-resources` through core `parseRegistry`, `json` parsed) and `optional`, or a read-only `value`.
An invalid entry is a `field` issue. The renderer sends the declarations of the listed issue-free plugins (key =
`installedKey`) to `plugins.configuration`; core `settingStates` (`plugins/configuration.ts`) answers stored with
references (supplier ids for parts) or missing, present/missing/invalid with the first problem through PathGuard
(256 KiB, regular file, not ignored) in the open workbench or unchecked without one, and value. Main reads references
from the two `PluginCredentialService`s and configured supplier keys from `PartsAccessService.get()`; a workbench id
that is not the open one is CONFLICT. `configurationNeeds` (missing secret, missing non-optional file, invalid file)
feeds `programReadiness` (Needs configuration unless a program is unavailable, also before programs are checked) and
the status block's Configuration check "Needs configuration: <names>". `renderer/components/plugin-configuration.tsx` lists each parameter with
its state and embeds `PluginCredentialsPanel` (mqtt, wokwi) or `PartsAccessPanel` (parts); both forms invalidate
`["plugin-configuration"]` after a change, and Check again re-asks for workbench files.

SSH agent socket (REQ-SEC-adb91424): a program of an official plugin that declares `sshAgent: true` gets
`RunRequest.inherit: ["SSH_AUTH_SOCK"]`, so the runner copies the host's SSH_AUTH_SOCK (when set) into that run's
and its cleanup run's environment; prepare refuses the declaration of any other tier before approval. No other
program receives it, and no key or password passes through VERA.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Declared parameters, Configuration section, Needs configuration | shared `plugin-settings.ts`, `ipc.ts`, core `plugins/configuration.ts`, `resource-registry.ts` (`parseRegistry`), desktop `main/index.ts` (`plugins.configuration`), renderer `plugin-configuration.tsx`, `plugin-credentials.tsx`, `parts-access.tsx`, `plugin-library.ts`, `plugins.tsx`, `mocks/mockApi.ts` | `shared/src/plugin-settings.test.ts`, `core/src/plugins/configuration.test.ts`, `store.test.ts`, `plugin-library.test.ts`, `plugins.test.ts`, `plugin-credentials.test.ts` |

## Key behaviors

- `REQ-DATA-e6b1fa1a` / `REQ-SEC-3f57f781` / `REQ-SEC-dbbd21e5` / `REQ-SEC-9976af2e` / `REQ-FUNC-00c788bb` /
  `REQ-FUNC-ba0396c0` — the credentials declaration, the stdin hand-off, official plugins only, revocation by disabling,
  unresolvable references, the runner's input.
- `REQ-SEC-1ffb429b` / `REQ-UX-4b90fed2` / `REQ-FUNC-f250eee7` — desktop credential storage and Settings section, CLI
  environment credentials.
