# The Windows Sandbox template

[VERA.wsb](VERA.wsb) is an example configuration for Windows Sandbox, used for manual checks of the
VERA packages in an isolated environment. It is not part of the application and does not start with
`npm run dev` or with the usual tests.

## What it configures

- Turns off the sandbox's network and clipboard redirection.
- Maps `D:\VERA-release-input` on the host to `C:\VERA-input` in the guest, read-only.
- Maps `D:\VERA-release-evidence` on the host to `C:\VERA-evidence` in the guest, writable, for the
  results of the check.

These paths are examples from the template; replace them with your own folders in a copy of the
file. The input can hold the exact artifact to check, its report and a copy of the fictional demo.
The output must be a new folder made for the run. Files written to `C:\VERA-evidence` stay on the
host in the mapped folder, also after the sandbox closes.

## Manual use

1. On a Windows machine where Windows Sandbox is available, prepare the input and output folders
   and a local copy of `VERA.wsb`.
2. In the local copy, replace the two `HostFolder` values with the real paths.
3. Open the `.wsb` copy to start the sandbox.
4. In the guest, run the chosen check procedure and save the results in `C:\VERA-evidence`.

This template has no `LogonCommand`: it does not install or test VERA automatically at start. The
configured network isolation alone does not prove that the application works offline; the relevant
scenario must be run and checked.

## Difference from the generated configuration

[`../probe-windows-sandbox.ps1`](../probe-windows-sandbox.ps1) generates another file,
`VERA-offline.wsb`, from the paths of the artifact and of the results folder. It computes hashes,
copies the offline probe and adds a script that starts automatically in the guest. With `-Launch` it
also starts Windows Sandbox. That is the flow for the **instrumented** ZIP, different from the
manual template here.

Validation of a release package through the application's ordinary flows is described in
[release-package-smoke.md](../../../05_Software/tests/packaging/smoke/README.md), including the Windows
steps for capturing traffic. The instrumented probes and the release checks have separate results
and purposes.

See also [02_Tools/README.md](../../README.md) for the inventory of tools.
