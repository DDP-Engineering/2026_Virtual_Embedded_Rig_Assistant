import { channels, settingsPatchSchema } from "@vera/shared";
import { describe, expect, it } from "vitest";
import {
  commandEnvironment,
  detectCommandShells,
  interactiveShellArguments,
  resolveCommandShell,
  shellArguments,
} from "./shell.js";

const find = (files: string[]) => async (path: string) => files.includes(path);
it("validates unique shell variants and absolute executable paths across IPC", () => {
  const channel = channels["commands.shells"];
  const options = ["pwsh", "powershell", "cmd", "bash"].map((id) => ({ id, executable: null }));
  expect(channel.request.safeParse({ path: "C:/other.exe" }).success).toBe(false);
  expect(channel.response.safeParse(options).success).toBe(true);
  expect(channel.response.safeParse([options[0], options[0], options[2], options[3]]).success).toBe(false);
  for (const executable of ["relative/bash.exe", "C:/bad\nname.exe", "", 12])
    expect(channel.response.safeParse([{ id: "pwsh", executable }, ...options.slice(1)]).success).toBe(false);
});
describe("platform shell resolution", () => {
  it("prefers PowerShell 7 and resolves mixed-case Windows PATH with spaces", async () => {
    const host = {
      platform: "win32",
      env: { Path: '"C:\\Program Files\\PowerShell\\7";C:\\Windows', SystemRoot: "C:\\Windows" },
    };
    expect(await resolveCommandShell(host, "", find(["C:\\Program Files\\PowerShell\\7\\pwsh.exe"]))).toEqual(
      {
        executable: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        kind: "powershell",
      },
    );
    expect(
      await resolveCommandShell(
        host,
        "",
        find(["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"]),
      ),
    ).toMatchObject({ kind: "powershell", executable: expect.stringContaining("powershell.exe") });
  });
  it.each(["bash", "sh"])("selects available Linux %s", async (name) => {
    expect(
      await resolveCommandShell(
        { platform: "linux", env: { PATH: "/usr/bin:/bin" } },
        "",
        find([`/bin/${name}`]),
      ),
    ).toEqual({ executable: `/bin/${name}`, kind: name });
  });
  it("honors explicit shells, refuses unavailable selections and ignores relative PATH entries", async () => {
    const host = { platform: "linux", env: { PATH: ".:/bin" } };
    expect(await resolveCommandShell(host, "/custom/zsh", find(["/custom/zsh"]))).toEqual({
      executable: "/custom/zsh",
      kind: "sh",
    });
    await expect(resolveCommandShell(host, "missing", find(["/bin/bash", "missing"]))).rejects.toThrow(
      "No command shell",
    );
    await expect(resolveCommandShell(host, "./bash", find([]))).rejects.toThrow("absolute path");
    await expect(
      resolveCommandShell({ platform: "win32", env: {} }, "C:\\other.exe", find(["C:\\other.exe"])),
    ).rejects.toThrow("Select PowerShell, Cmd");
  });
  it("finds standard installed shells when PATH is absent", async () => {
    expect(await resolveCommandShell({ platform: "linux", env: {} }, "", find(["/bin/sh"]))).toEqual({
      executable: "/bin/sh",
      kind: "sh",
    });
    expect(
      await resolveCommandShell(
        { platform: "win32", env: {} },
        "",
        find(["C:\\Program Files\\PowerShell\\7\\pwsh.exe"]),
      ),
    ).toMatchObject({ kind: "powershell" });
  });
});

it("detects all Windows families, including Git Bash beside git/cmd, without treating WSL as native Bash", async () => {
  const host = {
    platform: "win32",
    env: { Path: "C:\\Windows\\System32;D:\\Git\\cmd", SystemRoot: "C:\\Windows" },
  };
  const files = [
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "C:\\Windows\\System32\\cmd.exe",
    "C:\\Windows\\System32\\bash.exe",
    "D:\\Git\\bin\\bash.exe",
  ];
  expect(await detectCommandShells(host, find(files))).toEqual([
    { id: "pwsh", executable: files[0] },
    { id: "powershell", executable: files[1] },
    { id: "cmd", executable: files[2] },
    { id: "bash", executable: files[4] },
  ]);
  expect(await resolveCommandShell(host, "bash", find(files))).toEqual({
    executable: files[4],
    kind: "bash",
  });
  expect(await resolveCommandShell(host, "cmd", find(files))).toEqual({ executable: files[2], kind: "cmd" });
  await expect(resolveCommandShell(host, files[3], find(files))).rejects.toThrow("No command shell");
});

it("reports unavailable variants explicitly and supports PowerShell on Linux", async () => {
  expect(await detectCommandShells({ platform: "win32", env: {} }, find([]))).toEqual(
    ["pwsh", "powershell", "cmd", "bash"].map((id) => ({ id, executable: null })),
  );
  const host = { platform: "linux", env: { PATH: "/bin:/opt/tools" } };
  expect(await resolveCommandShell(host, "/opt/tools/pwsh", find(["/opt/tools/pwsh"]))).toMatchObject({
    kind: "powershell",
  });
});

it("uses Cmd quoting without silently discarding multiline commands and gives each terminal its startup arguments", () => {
  const shell = { executable: "C:\\Windows\\System32\\cmd.exe", kind: "cmd" as const };
  expect(shellArguments(shell, 'echo "A&B"')).toEqual(["/d", "/s", "/c", '"echo "A&B""']);
  expect(() => shellArguments(shell, "echo first\necho second")).toThrow("one line");
  for (const [kind, args] of [
    ["powershell", ["-NoLogo"]],
    ["cmd", ["/d"]],
    ["bash", ["-il"]],
    ["sh", ["-i"]],
  ] as const)
    expect(interactiveShellArguments({ executable: kind, kind })).toEqual(args);
});
describe("literal shell syntax", () => {
  const command = "node -e \"console.log('é; $x `&')\"\nprintf '%s' '$HOME'";
  it.each(["bash", "sh"] as const)("preserves the entire command as a single %s argument", (kind) => {
    expect(shellArguments({ executable: kind, kind }, command)).toEqual([
      kind === "bash" ? "-lc" : "-c",
      command,
    ]);
  });
  it.each(["pwsh.exe", "powershell.exe"])(
    "quotes script literal for %s and configures UTF-8",
    (executable) => {
      const args = shellArguments({ executable, kind: "powershell" }, command);
      expect(args.slice(0, 4)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
      expect(args[4]).toContain(command.replaceAll("'", "''"));
      expect(args[4]).toContain("UTF8Encoding");
      expect(args[4]).toContain("exit $LASTEXITCODE");
      // The fallback for Constrained Language Mode needs no .NET call.
      expect(args[4]).toMatch(/LanguageMode -eq 'FullLanguage'.*else \{ Invoke-Expression \$veraCommand \}$/);
    },
  );
});
it("filters secret names and stored-secret aliases while inheriting ordinary user configuration", () => {
  const env = commandEnvironment(
    {
      Path: "tools",
      USER_BUILD_MODE: "fast",
      HOME: "/home/user",
      VERA_OPENAI_KEY: "a",
      vera_test_mode: "1",
      OPENAI_API_KEY: "b",
      anthropic_api_key: "c",
      Custom_Token: "d",
      OTHER_ALIAS: "prefix stored-secret suffix",
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: "--inspect",
      EMPTY: "",
      UNSET: undefined,
    },
    (value) => value.replaceAll("stored-secret", "[redacted]"),
  );
  expect(env).toEqual({ Path: "tools", USER_BUILD_MODE: "fast", HOME: "/home/user", EMPTY: "" });
});
it("validates the shell setting and permits an empty automatic selection", () => {
  expect(settingsPatchSchema.parse({ shell: "  pwsh  " })).toEqual({ shell: "pwsh" });
  expect(settingsPatchSchema.parse({ shell: "" })).toEqual({ shell: "" });
  expect(settingsPatchSchema.safeParse({ shell: "pwsh\n-Command evil" }).success).toBe(false);
  expect(settingsPatchSchema.safeParse({ shell: "a".repeat(4097) }).success).toBe(false);
});
