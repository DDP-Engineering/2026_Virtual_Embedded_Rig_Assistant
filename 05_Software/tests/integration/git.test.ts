import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import {
  classifyCommand,
  gitExecutionArguments,
  type PluginManifest,
  validatePluginManifest,
} from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";

const source = new URL("../../plugins/git/", import.meta.url);
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("plugin.yaml", source), "utf8"));

it("publishes the find-only Git package and three bounded workflows", async () => {
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m.programs.git?.install).toEqual({
    find: {
      windows: ["%PATH%", "C:/Program Files/Git/cmd/git.exe", "%LOCALAPPDATA%/Programs/Git/cmd/git.exe"],
      linux: ["$PATH", "/usr/bin/git"],
    },
    hint: "Install Git for Windows or your distribution's git package.",
  });
  expect(m.programs.git?.version.range).toBe(">=2.40");
  for (const name of ["git-inspect", "git-commit", "git-branches"])
    expect(await readFile(new URL(`skills/${name}/SKILL.md`, source), "utf8")).toMatch(
      new RegExp(`name: ${name}\\r?\\n`),
    );
});

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const windows = process.platform === "win32";
const evidence = process.env.VERA_TEST_EVIDENCE_DIR;

it("runs real Git history without approval, suppresses marker helpers, and commits only after approval", async () => {
  const root = await realpath(await mkdtemp(join(evidence ?? tmpdir(), "git-fixture-")));
  const bench = join(root, "bench");
  const native = new core.NodeProcessHost(spawn);
  const home = join(root, "home");
  const starts: { args: readonly string[]; env: Readonly<Record<string, string>> }[] = [];
  // Isolate user configuration while retaining real PATH and platform process behavior.
  const host: core.ProcessHost = {
    platform: native.platform,
    env: { ...native.env, HOME: home, USERPROFILE: home },
    spawn(executable, args, options) {
      starts.push({ args: [...args], env: options.env });
      return native.spawn(executable, args, options);
    },
    signal: native.signal.bind(native),
  };
  const runner = new core.ProgramRunner({ host, clock: { sleep } });
  let service: core.SessionService | undefined;
  let provisioner: core.Provisioner | undefined;
  let database: Awaited<ReturnType<typeof core.openDb>> | undefined;
  const receipts: unknown[] = [];
  const server = createServer((_request, response) => {
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="fixture"' });
    response.end("Fixture authentication required\n");
  });
  try {
    await mkdir(join(bench, ".vera"), { recursive: true });
    await mkdir(home);
    await mkdir(join(root, "scripts"));
    await writeFile(join(home, ".gitconfig"), "[credential]\n\thelper =\n");
    const release = await core.buildCatalogRelease(
      fileURLToPath(new URL("../../plugins/", import.meta.url)),
      join(root, "release"),
    );
    expect(release.issues).toEqual([]);
    expect(release.index?.plugins.find((item) => item.id === "git")?.tier).toBe("official");
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(join(root, "release/git-1.0.0.zip"));
    const plugin = await store.load("git");
    expect(await readFile(join(plugin.folder, "no-hooks/README.txt"), "utf8")).toContain("no Git hook names");
    provisioner = new core.Provisioner({
      store,
      host,
      root: join(root, "runtime"),
      platform: windows ? "windows-x64" : "linux-x64",
      clock: { sleep },
      settings: () => undefined,
      fetch: async () => {
        throw Error("Git must never download");
      },
    });
    const resolved = await provisioner.resolve(plugin, "git");
    if (!resolved) throw Error("Git >=2.40 is required for native acceptance");
    expect(resolved.version).toMatch(/^\d+\.\d+\.\d+$/);
    const oldGit = new core.Provisioner({
      store,
      root: join(root, "old-runtime"),
      platform: windows ? "windows-x64" : "linux-x64",
      host: {
        ...host,
        spawn(_exe, _args, options) {
          options.output("stdout", Buffer.from("git version 2.39.9\n"));
          return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
        },
      },
      clock: { sleep },
      settings: () => undefined,
      fetch: async () => {
        throw Error("No Git download");
      },
    });
    try {
      expect(await oldGit.resolve(plugin, "git")).toBeUndefined();
      expect(await oldGit.statuses("git")).toMatchObject([
        { state: "unavailable", problem: "range", version: "2.39.9" },
      ]);
    } finally {
      oldGit.close();
    }
    receipts.push({
      executable: resolved.executable,
      version: resolved.version,
      platform: process.platform,
      arch: process.arch,
    });
    const prefix =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal manifest placeholder.
      plugin.manifest.programs.git?.prefix?.map((arg) => arg.replaceAll("${pluginDir}", plugin.folder)) ?? [];
    const env = plugin.manifest.programs.git?.env ?? {};
    async function run(args: string[], fixed = true) {
      const result = await (
        await runner.start({
          sessionId: "fixture-setup",
          workbench: bench,
          executable: resolved?.executable as string,
          args: [...(fixed ? prefix : []), ...(fixed ? gitExecutionArguments(args) : args)],
          env,
          timeoutMs: 10_000,
        })
      ).done;
      receipts.push({ args, fixed, ...result });
      return result;
    }
    for (const args of [
      ["init", "--initial-branch=main"],
      ["config", "user.name", "Fixture User"],
      ["config", "user.email", "fixture@example.invalid"],
    ])
      expect((await run(args, false)).exitCode).toBe(0);
    await writeFile(join(bench, ".gitignore"), ".vera/\n");
    await writeFile(join(bench, "file.txt"), "initial\n");
    await writeFile(join(bench, "list"), "original list file\n");
    expect((await run(["add", "--", ".gitignore", "file.txt", "list"])).exitCode).toBe(0);
    expect((await run(["commit", "-m", "Initial fixture"])).exitCode).toBe(0);
    expect((await run(["tag", "v1"])).exitCode).toBe(0);
    await writeFile(join(bench, "file.txt"), "initial\nsecond\n");
    expect((await run(["add", "--", "file.txt"])).exitCode).toBe(0);
    expect((await run(["commit", "-m", "Fixture release change"])).exitCode).toBe(0);
    const releaseHash = (await run(["rev-parse", "HEAD"])).output.trim();
    expect(releaseHash).toMatch(/^[0-9a-f]{40}$/);

    // Git treats `stash -- list` as a push restricted to a file named list, not as a listing.
    await writeFile(join(bench, "list"), "original list file\nstashed list change\n");
    expect(classifyCommand(plugin.manifest.rules, "git", ["stash", "--", "list"], "git").risk).toBe(
      "device-write",
    );
    expect((await run(["stash", "--", "list"])).exitCode).toBe(0);
    expect((await readFile(join(bench, "list"), "utf8")).replaceAll("\r\n", "\n")).toBe(
      "original list file\n",
    );
    receipts.push({ control: "stash -- list changed stored state and restored the tracked path" });

    const marker = join(root, "marker");
    const script = join(root, "marker.sh").replaceAll("\\", "/");
    await writeFile(
      script,
      `#!/bin/sh\nprintf 'executed\\n' >> '${marker.replaceAll("\\", "/")}'\nexit 0\n`,
      { mode: 0o755 },
    );
    const configured = `"${script}"`;
    for (const key of ["core.fsmonitor", "core.pager", "diff.external", "core.editor", "sequence.editor"])
      expect((await run(["config", key, configured], false)).exitCode).toBe(0);
    await writeFile(join(bench, ".git/hooks/pre-commit"), `#!/bin/sh\nexec '${script}'\n`, { mode: 0o755 });
    // Positive control: the fsmonitor fixture really can execute through unguarded Git.
    await run(["status", "--short"], false);
    expect(await readFile(marker, "utf8")).toContain("executed");
    await rm(marker);
    // Fabricated signed objects need no keys or GPG installation. The controlled verification
    // program marks invocation even when it cannot verify the artificial signature.
    const tree = (await run(["rev-parse", "HEAD^{tree}"])).output.trim();
    const signedCommitFile = join(root, "signed.commit");
    await writeFile(
      signedCommitFile,
      `tree ${tree}\nparent ${releaseHash}\nauthor Fixture <fixture@example.invalid> 1234567890 +0000\ncommitter Fixture <fixture@example.invalid> 1234567890 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n Zml4dHVyZQ==\n -----END PGP SIGNATURE-----\n\nSigned fixture\n`,
    );
    const signedHash = (await run(["hash-object", "-t", "commit", "-w", signedCommitFile])).output.trim();
    expect(signedHash).toMatch(/^[0-9a-f]{40}$/);
    expect((await run(["update-ref", "refs/heads/signed-fixture", signedHash])).exitCode).toBe(0);
    const signedTagFile = join(root, "signed.tag");
    await writeFile(
      signedTagFile,
      `object ${signedHash}\ntype commit\ntag signed-fixture\ntagger Fixture <fixture@example.invalid> 1234567890 +0000\n\nSigned fixture tag\n-----BEGIN PGP SIGNATURE-----\n\nZml4dHVyZQ==\n-----END PGP SIGNATURE-----\n`,
    );
    const signedTagHash = (await run(["hash-object", "-t", "tag", "-w", signedTagFile])).output.trim();
    expect((await run(["update-ref", "refs/tags/signed-fixture", signedTagHash])).exitCode).toBe(0);
    expect((await run(["config", "gpg.program", script], false)).exitCode).toBe(0);
    const signatureCommands = [
      ["for-each-ref", "--format=%(signature:grade)"],
      ["for-each-ref", "--sort=signature:grade"],
      ["log", "-n1", "--format=%+G?", signedHash],
      ["log", "-n1", "--format=%GZ", signedHash],
      ["branch", "--sort=signature:grade"],
      ["tag", "--list", "--sort=-*signature:grade"],
      ["tag", "--list", "--format=%(*signature:grade)"],
      ["shortlog", "--group=format:%+G?", signedHash],
    ];
    for (const args of signatureCommands) {
      const control = await run(args);
      expect(control.exitCode, JSON.stringify({ args, output: control.output })).toBe(0);
      expect(await readFile(marker, "utf8"), args.join(" ")).toContain("executed");
      await rm(marker);
    }
    await writeFile(join(bench, "file.txt"), "initial\nsecond\napproved change\n");
    expect((await run(["add", "--", "file.txt"])).exitCode).toBe(0);
    const inspectionCommands = [
      ["status", "--short", "--branch"],
      ["log", "-n", "20", "--oneline", "--decorate"],
      ["diff", "--stat", "v1", "HEAD"],
      ["diff", "--staged", "--", "file.txt"],
      ["diff", "--", "file.txt"],
      ["-P", "diff", "v1", "HEAD", "--", "file.txt"],
      ["log", "-n1", "-p", "--", "file.txt"],
      ["show", "HEAD", "--", "file.txt"],
      ["stash", "list", "-n1", "-p"],
      ["stash", "show"],
      ["stash", "show", "--stat"],
      ["reflog", "show", "-n1", "-p"],
      ["reflog", "-n1", "-p"],
      ["diff", "--no-ext-diff", "--staged", "--", "file.txt"],
    ];
    const globalExternalControl = await run(["-c", "core.fsmonitor=false", "diff", "--staged"], false);
    expect(globalExternalControl.exitCode).toBe(0);
    expect(await readFile(marker, "utf8")).toContain("executed");
    await rm(marker);
    receipts.push({ control: "unguarded global diff.external executes the marker" });
    // Also select a repository-local named external driver, independently of diff.external.
    expect((await run(["config", "--unset", "diff.external"], false)).exitCode).toBe(0);
    expect((await run(["config", "diff.fixture.command", configured], false)).exitCode).toBe(0);
    await writeFile(join(bench, ".git/info/attributes"), "file.txt diff=fixture\n");
    const externalControl = await run(["-c", "core.fsmonitor=false", "diff", "--staged"], false);
    expect(externalControl.exitCode).toBe(0);
    expect(await readFile(marker, "utf8")).toContain("executed");
    await rm(marker);
    receipts.push({ control: "unguarded repository external-diff driver executes the marker" });
    expect((await run(["config", "diff.external", configured], false)).exitCode).toBe(0);
    await writeFile(join(bench, "file.txt"), "initial\nsecond\napproved change\nworktree change\n");
    const steps = [
      ...inspectionCommands.map((args) => ({
        toolCalls: [{ name: "run_program", args: { program: "git", args } }],
      })),
      {
        toolCalls: [
          {
            name: "run_program",
            args: { program: "git", args: ["commit", "-m", "Approved fixture change"] },
          },
        ],
      },
      {
        text: `Since v1, ${releaseHash} (Fixture release change) adds the second line to file.txt. The reviewed change is committed.`,
      },
    ];
    await writeFile(join(root, "scripts/git.jsonl"), steps.map((step) => JSON.stringify(step)).join("\n"));
    await writeFile(
      join(root, "scripts/blocked.jsonl"),
      [
        { toolCalls: [{ name: "run_program", args: { program: "git", args: ["fixture-alias"] } }] },
        {
          toolCalls: [
            {
              name: "run_program",
              args: {
                program: "git",
                args: ["-c", `core.hooksPath=${join(bench, ".git/hooks")}`, "commit", "-m", "Forbidden"],
              },
            },
          ],
        },
        {
          toolCalls: [
            { name: "run_program", args: { program: "git", args: ["grep", `-O${script}`, "initial"] } },
          ],
        },
        ...signatureCommands.map((args) => ({
          toolCalls: [{ name: "run_program", args: { program: "git", args } }],
        })),
        ...[
          ["diff", "--ext-diff", "--", "file.txt"],
          ["-P", "diff", "--no-no-ext-diff", "--", "file.txt"],
        ].map((args) => ({
          toolCalls: [{ name: "run_program", args: { program: "git", args } }],
        })),
        {
          text: "The executable alias, configuration override, pager and signature helper commands were refused.",
        },
      ]
        .map((step) => JSON.stringify(step))
        .join("\n"),
    );
    const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: Date.now });
    await gateway.models("replay", new AbortController().signal);
    database = await core.openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
    const skills = new core.SkillCatalog({
      root: bench,
      disabled: () => [],
      plugins: async () => [{ id: "git", folder: plugin.folder }],
    });
    expect(
      (await skills.list()).filter((skill) => skill.plugin === "git").map((skill) => skill.name),
    ).toEqual(["git-branches", "git-commit", "git-inspect"]);
    for (const name of ["git-inspect", "git-commit", "git-branches"])
      expect((await skills.read("plugin", name)).content.length).toBeGreaterThan(500);
    let replayModel = "replay/git";
    service = new core.SessionService({
      root: bench,
      db: database.db,
      gateway,
      clock: { now: () => new Date(), sleep },
      model: () => replayModel,
      prompt: () => "Use the Git plugin",
      skills,
      programs: { runner, clock: { sleep }, plugins: async () => [plugin], resolver: provisioner },
    });
    await service.waitReady();
    const session = service.create(null, "ask");
    const outputs: { ok: boolean; summary: string }[] = [];
    service.subscribe(session.id, 0, (_seq, event) => {
      if (event.type === "tool.done") outputs.push({ ok: event.ok, summary: event.summary });
    });
    const start = starts.length;
    service.send(session.id, "Explain what changed since v1 and commit the reviewed fixture change.");
    const pending = () => service?.get(session.id).snapshot.approvals.find((item) => !item.decision);
    await expect.poll(pending, { timeout: 45_000 }).toBeDefined();
    const approval = pending();
    if (!approval) throw Error("Expected commit approval");
    expect(approval.program).toMatchObject({
      program: "git",
      risk: "device-write",
      args: ["commit", "-m", "Approved fixture change"],
    });
    expect(service.get(session.id).snapshot.approvals).toHaveLength(1);
    expect(outputs).toHaveLength(inspectionCommands.length);
    receipts.push({
      rawInspectionOutputs: outputs.map((output) => ({ ...output })),
      rawInspectionArguments: inspectionCommands,
    });
    expect(outputs.every((output) => output.ok)).toBe(true);
    const inspections = outputs.map(
      (output) => JSON.parse(output.summary) as { exitCode: number; output: string },
    );
    for (const inspection of inspections) expect(inspection.exitCode, inspection.output).toBe(0);
    expect(inspections[3]?.output).toContain("diff --git a/file.txt b/file.txt");
    expect(inspections[3]?.output).toContain("+approved change");
    expect(inspections[4]?.output).toContain("+worktree change");
    for (const index of [5, 6, 7, 11, 12]) expect(inspections[index]?.output).toContain("+second");
    for (const index of [8, 9]) expect(inspections[index]?.output).toContain("+stashed list change");
    expect(inspections[10]?.output).toContain("list");
    expect(inspections[10]?.output).not.toContain("diff --git");
    expect(inspections[13]?.output).toContain("+approved change");
    for (const [index, output] of outputs.entries()) {
      const result = JSON.parse(output.summary) as { log: string };
      const record = JSON.parse(await readFile(join(bench, result.log.replace(/\.log$/, ".json")), "utf8"));
      expect(record.args).toEqual(inspectionCommands[index]);
      expect(starts[start + index]?.args).toEqual([
        ...prefix,
        ...gitExecutionArguments(inspectionCommands[index] ?? []),
      ]);
    }
    receipts.push({ acceptedInspections: inspections, rawInspectionArguments: inspectionCommands });
    expect(outputs[1]?.summary).toContain("Fixture release change");
    expect(outputs[1]?.summary).toContain(releaseHash.slice(0, 7));
    expect(outputs[2]?.summary).toContain("file.txt");
    expect(starts.slice(start).filter((call) => call.args.includes("commit"))).toHaveLength(0);
    service.decideApproval({
      sessionId: session.id,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision: "approved",
    });
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    expect(outputs).toHaveLength(inspectionCommands.length + 1);
    expect(outputs.at(-1)?.ok).toBe(true);
    expect(JSON.parse(outputs.at(-1)?.summary ?? "{}").exitCode).toBe(0);
    for (const call of starts.slice(start)) {
      expect(call.args.slice(0, prefix.length)).toEqual(prefix);
      expect(call.env).toMatchObject(env ?? {});
    }
    expect((await run(["log", "-n1", "--format=%s"])).output).toContain("Approved fixture change");
    const outputFile = join(root, "native-output.patch");
    expect((await run(["diff", "--staged", `--output=${outputFile}`])).exitCode).toBe(0);
    expect(await readFile(outputFile, "utf8")).toBe("");
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await run(["config", "alias.fixture-alias", `!${configured}`], false)).exitCode).toBe(0);
    replayModel = "replay/blocked";
    const bypass = service.create(null, "bypass");
    const refused: boolean[] = [];
    service.subscribe(bypass.id, 0, (_seq, event) => {
      if (event.type === "tool.done") refused.push(!event.ok);
    });
    const beforeBlocked = starts.length;
    service.send(bypass.id, "Try the blocked fixture commands");
    expect(await service.waitIdle(bypass.id)).toEqual({ stopReason: "end" });
    expect(refused).toEqual(Array<boolean>(5 + signatureCommands.length).fill(true));
    expect(service.get(bypass.id).snapshot.approvals).toEqual([]);
    expect(starts).toHaveLength(beforeBlocked);
    // Git for Windows executes ':' using bundled sh, just as Linux does. The empty-message exit
    // and successful no-op sequence-editor rebase prove the real environment, without interactive UI.
    await writeFile(join(bench, "file.txt"), "initial\nsecond\napproved change\n");
    const editor = await run(["commit", "--allow-empty"]);
    expect(editor.exitCode).not.toBe(0);
    expect(editor.output).toContain("empty commit message");
    expect((await run(["rebase", "-i", "HEAD~1"])).exitCode).toBe(0);
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Missing loopback fixture");
    const fetched = await run(["fetch", `http://127.0.0.1:${address.port}/private.git`]);
    expect(fetched.exitCode).not.toBe(0);
    expect(fetched.timedOut).toBe(false);
    expect(fetched.durationMs).toBeLessThan(10_000);
    expect(fetched.output).toMatch(
      /terminal prompts disabled|could not read Username|Authentication failed/i,
    );
    receipts.push({ approval: approval.program, outputs, starts: starts.slice(start), noMarker: true });
    if (evidence)
      await writeFile(
        join(evidence, `${process.platform}-git-native.json`),
        JSON.stringify(receipts, null, 2),
      );
  } finally {
    if (evidence)
      await writeFile(
        join(evidence, `${process.platform}-git-diagnostics.json`),
        JSON.stringify(receipts, null, 2),
      );
    await service?.close();
    await runner.stopAll();
    provisioner?.close();
    database?.close();
    if (server.listening)
      await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);

it("classifies every Git row and option-role collision at the highest risk", async () => {
  const m = await manifest();
  const classify = (args: readonly string[]) =>
    classifyCommand(m.rules, "git", args, m.programs.git?.optionSyntax);
  const cases = [
    ["device-write", ["stash", "--", "list"]],
    ["device-write", ["stash", "--", "show"]],
    ["device-write", ["stash", "-q", "list"]],
    ["safe", ["stash", "show", "-p"]],
    ["safe", ["stash", "list", "-n1", "-p"]],
    ["safe", ["reflog", "show", "-n1", "-p"]],
    ["blocked", ["stash", "-p"]],

    ["device-write", ["merge", "--no-edit", "topic"]],
    ["device-write", ["cherry-pick", "--no-edit", "HEAD"]],
    ["blocked", ["merge", "--no-no-edit", "topic"]],
    ["device-write", ["for-each-ref"]],
    ["blocked", ["for-each-ref", "--format=%(signature:grade)"]],
    ["blocked", ["for-each-ref", "--sort=signature:grade"]],
    ["blocked", ["--version", "--help"]],
    ["blocked", ["-v", "--help"]],
    ["safe", ["-P", "log", "-n1"]],
    ["blocked", ["pull", "--reb=interactive"]],
    ["blocked", ["pull", "-ri"]],
    ["blocked", ["pull", "-rinteractive"]],
    ["blocked", ["log", "--format=%+G?"]],
    ["blocked", ["log", "--format=%-G?"]],
    ["blocked", ["log", "--pretty=tformat:% G?"]],
    ["blocked", ["log", "--format=%GZ"]],
    ["blocked", ["branch", "--sort=signature:grade"]],
    ["blocked", ["tag", "--list", "--sort=-*signature:grade"]],
    ["blocked", ["tag", "--list", "--sort=version:signature:grade"]],
    ["blocked", ["tag", "--list", "--format=%(*signature:grade)"]],
    ["blocked", ["shortlog", "--group=format:%+G?"]],
    ["device-write", ["log", "--format", "--output=out"]],
    ["device-write", ["log", "--pretty", "--output=out"]],
    ["device-write", ["branch", "-a", "--color", "--delete", "x"]],
    ["device-write", ["branch", "-a", "--abbrev", "-D", "x"]],
    ["safe", ["help", "--all"]],
    ["safe", ["help", "-c"]],
    ["safe", ["version", "--build-options"]],
    ["blocked", ["log", "--help"]],
    ["blocked", ["log", "--format=%G?"]],
    ["blocked", ["branch", "--format=%(signature:grade)"]],
    ["blocked", ["clone", "-u", "helper", "url"]],
    ["blocked", ["clone", "-c", "core.hooksPath=x", "url"]],
    ["blocked", ["ls-remote", "-uhelper", "origin"]],
    ["blocked", ["am", "-i"]],
    ["blocked", ["commit", "-p"]],
    ["blocked", ["reset", "-p"]],
    ["blocked", ["rebase", "--edit-todo"]],
    ["blocked", ["pull", "--rebase=interactive"]],
    ["irreversible", ["push", "--no-no-force", "origin", "main"]],
    ["device-write", ["push", "-o--force", "origin", "main"]],

    ["safe", ["--version"]],
    ["safe", ["-v"]],
    ["safe", ["version"]],
    ["safe", ["help"]],
    ...[
      "status",
      "log",
      "diff",
      "show",
      "blame",
      "shortlog",
      "describe",
      "rev-parse",
      "rev-list",
      "ls-files",
      "ls-tree",
      "cat-file",
      "grep",
      "reflog",
      "merge-base",
      "name-rev",
    ].map((command) => ["safe", [command]] as const),
    ["safe", ["--no-pager", "log", "-n20", "--oneline", "--decorate"]],
    ["safe", ["log", "--max-count=20", "v1..HEAD"]],
    ["safe", ["diff", "--stat", "v1", "HEAD"]],
    ["safe", ["diff", "--staged", "--", "--output=file", "-c"]],
    ["safe", ["blame", "-L1,10", "--", "file.c"]],
    ["safe", ["grep", "-n", "-e", "-O", "--", "f"]],
    ["safe", ["branch"]],
    ["safe", ["branch", "-avv"]],
    ["safe", ["branch", "--contains", "HEAD"]],
    ["safe", ["branch", "--merged=HEAD"]],
    ["safe", ["branch", "--no-merged"]],
    ["safe", ["tag"]],
    ["safe", ["tag", "-ln9", "v*"]],
    ["safe", ["remote"]],
    ["safe", ["remote", "-v"]],
    ["safe", ["stash", "list"]],
    ["safe", ["stash", "show", "--stat", "stash@{0}"]],
    ...[
      "add",
      "commit",
      "switch",
      "merge",
      "rebase",
      "cherry-pick",
      "revert",
      "reset",
      "mv",
      "rm",
      "apply",
      "am",
      "init",
      "fetch",
      "pull",
      "clone",
      "ls-remote",
      "push",
    ].map((command) => ["device-write", [command]] as const),
    ...[[], ["push"], ["pop"], ["apply"], ["save"], ["branch", "new"]].map(
      (args) => ["device-write", ["stash", ...args]] as const,
    ),
    ["device-write", ["branch", "new"]],
    ["device-write", ["tag", "v2"]],
    ["device-write", ["remote", "add", "x", "url"]],
    ...["-d", "-D", "--delete", "-m", "-M", "--move", "-f", "--force"].map(
      (flag) => ["device-write", ["branch", "-a", flag, "x"]] as const,
    ),
    ["device-write", ["branch", "-aDx"]],
    ["device-write", ["tag", "-ld", "v1"]],
    ...["--delete", "--force", "-f"].map((flag) => ["device-write", ["tag", "-l", flag, "v1"]] as const),
    ...["remove", "rm", "rename", "set-url", "prune", "update"].map(
      (sub) => ["device-write", ["remote", "-v", sub, "x"]] as const,
    ),
    ["device-write", ["status", "--future-option"]],
    ["device-write", ["reset", "--", "--hard"]],
    ["device-write", ["commit", "-m", "-c core.hooksPath=x"]],
    ["irreversible", ["reset", "--hard"]],
    ["irreversible", ["reset", "--ha", "HEAD"]],
    ...["clean", "restore", "checkout"].map((command) => ["irreversible", [command, "--", "f"]] as const),
    ["irreversible", ["restore", "f"]],
    ...["-f", "--force", "--discard-changes"].map(
      (flag) => ["irreversible", ["switch", flag, "main"]] as const,
    ),
    ["irreversible", ["switch", "-qf", "main"]],
    ...["drop", "clear"].map((sub) => ["irreversible", ["stash", sub]] as const),
    ...[
      "-f",
      "--force",
      "--force-with-lease=main:abc",
      "--delete",
      "--mirror",
      "--prune",
      "--force-if-includes",
    ].map((flag) => ["irreversible", ["push", flag, "origin", "main"]] as const),
    ...["+main:main", ":refs/heads/main", "+:refs/heads/main"].map(
      (ref) => ["irreversible", ["push", "--", "origin", ref]] as const,
    ),
    ["irreversible", ["push", "-vf", "origin", "main"]],
    ["irreversible", ["gc", "--prune=now"]],
    ["irreversible", ["gc", "--prune"]],
    ...["expire", "delete", "drop"].map((sub) => ["irreversible", ["reflog", sub]] as const),
    ...[
      ["-c", "core.hooksPath=x", "status"],
      ["-ccore.hooksPath=x", "status"],
      ["-C../x", "status"],
      ["-C", "../x", "status"],
      ["--git-dir=x", "log"],
      ["--work-tree", "x", "log"],
      ["--exec-path=x", "status"],
      ["--config-env=core.hooksPath=X", "status"],
      ["--bare", "status"],
      ["-p", "help", "config"],
    ].map((args) => ["blocked", args] as const),
    ...[
      "config",
      "bisect",
      "filter-branch",
      "filter-repo",
      "mergetool",
      "difftool",
      "gui",
      "citool",
      "daemon",
      "instaweb",
      "send-email",
      "credential",
      "credential-manager",
      "hook",
      "alias-name",
      "!echo",
      "Log",
    ].map((command) => ["blocked", [command]] as const),
    ["blocked", ["submodule", "--quiet", "foreach", "echo"]],
    ...["-i", "--interactive", "-xecho", "--exec=echo", "--exe=echo", "-qi"].map(
      (flag) => ["blocked", ["rebase", flag, "HEAD~1"]] as const,
    ),
    ...["-i", "-p", "-e", "--interactive", "--patch", "--edit", "-Np", "--inter"].map(
      (flag) => ["blocked", ["add", flag, "f"]] as const,
    ),
    ["blocked", ["grep", "-O"]],
    ["blocked", ["grep", "-nOcat", "pattern"]],
    ["blocked", ["grep", "--open-files-in-pager=cat", "x"]],
    ["blocked", ["diff", "--ext-diff"]],
    ["blocked", ["diff", "--textconv"]],
    ["blocked", ["cat-file", "--filters", "HEAD:f"]],
    ["blocked", ["show", "--textc", "HEAD:f"]],
    ["blocked", ["help", "config"]],
    ["blocked", ["--help", "status"]],
    ["blocked", ["commit", "--config-env=x=y"]],
    ["blocked", ["commit", "--gpg-sign"]],
    ["blocked", ["commit", "-mmessage", "-Skey"]],
    ["blocked", ["merge", "--strategy=helper"]],
    ["blocked", ["fetch", "--upload-pack=echo", "origin"]],
    ["blocked", ["push", "--receive-pack=echo", "origin"]],
    ["device-write", ["log", "--output=out"]],
    ["device-write", ["diff", "--out", "out"]],
    ["device-write", ["rev-list", "--disk-usage", "--output=out", "HEAD"]],
    ["blocked", ["branch", "--edit-description"]],
    ["blocked", ["tag", "-s", "v2"]],
    ["safe", ["diff", "--no-textconv", "--no-ext-diff"]],
    ["safe", ["grep", "-o", "x"]],
    ["device-write", ["push", "origin", "main:other"]],
    ["device-write", ["push", "--repo=origin", "main"]],
    ["blocked", ["-c", "core.pager=echo", "branch", "-a", "-D", "x"]],
  ] as const;
  for (const [risk, args] of cases) expect.soft(classify(args).risk, args.join(" ")).toBe(risk);
  expect(classify(["checkout", "--", "f"]).confirm).toBe("checkout");
});
