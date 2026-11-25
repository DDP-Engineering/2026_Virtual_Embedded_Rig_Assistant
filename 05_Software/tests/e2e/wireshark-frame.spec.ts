import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { zipSync } from "fflate";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "../../src/apps/desktop");
const installation = process.env.VERA_WIRESHARK_ACCEPTANCE;
const plugin = "wireshark-tshark";
const sha256 = (input: Buffer | Uint8Array | string) => createHash("sha256").update(input).digest("hex");

async function catalog(folder: string) {
  const source = join(here, "../../plugins", plugin);
  const entries: Record<string, Uint8Array> = {};
  for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    entries[`${plugin}/${relative(source, file).replaceAll("\\", "/")}`] = await readFile(file);
  }
  const version = /^version: (\S+)/m.exec(new TextDecoder().decode(entries[`${plugin}/plugin.yaml`]))?.[1];
  if (!version) throw Error("The offline plugin has no version.");
  const zip = zipSync(entries);
  const url = `${plugin}-${version}.zip`;
  await mkdir(folder);
  await writeFile(join(folder, url), zip);
  await writeFile(
    join(folder, "index.json"),
    JSON.stringify({
      format: 1,
      plugins: [
        {
          id: plugin,
          version,
          tier: "official",
          ecosystem: "wireshark",
          platforms: ["windows-x64", "linux-x64"],
          name: "Wireshark (TShark)",
          summary: "Inspect captures offline.",
          description: "Inspect saved network captures.",
          risk: "device-read",
          requires: [],
          dependencies: [],
          url,
          sha256: sha256(zip),
          bytes: zip.length,
        },
      ],
      packs: [],
    }),
  );
}

async function captureRef(
  folder: string,
  path: string,
  number: number,
  epoch: string,
  version: string,
  filter: string | null,
) {
  const bytes = await readFile(join(folder, path));
  const capture = {
    format: 1,
    source: { kind: "workbench", path },
    fileFormat: "pcapng",
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
  const frame = { captureSha256: capture.sha256, number, interfaceId: 0, timestampEpoch: epoch };
  const analysis = { tool: "tshark", version, profile: "vera-offline-v1", decodeAs: [], filter };
  return `capture:${sha256(JSON.stringify([capture, frame, analysis]))}#f=${number}`;
}

async function viewerProcess(root: string, name: string, action: "inspect" | "close" | "list") {
  const { stdout } = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(here, "../support/wireshark-window.ps1"),
      "-CaptureRoot",
      root,
      "-CaptureName",
      name,
      "-Action",
      action,
    ],
    { timeout: 10_000, windowsHide: true },
  );
  return stdout.trim();
}

test("opens the cited and derived offline frames in native Wireshark", async () => {
  const info = test.info();
  test.skip(
    process.platform !== "win32" || !installation,
    "Set VERA_WIRESHARK_ACCEPTANCE to a native Windows Wireshark installation.",
  );
  test.setTimeout(120_000);
  if (!installation || !isAbsolute(installation))
    throw Error("Wireshark installation must be an absolute directory.");
  const evidence = process.env.VERA_WIRESHARK_EVIDENCE_DIR;
  const root = await mkdtemp(join(tmpdir(), "vera-334-native-"));
  const workbench = join(root, "workbench");
  const scripts = join(root, "scripts");
  const release = join(root, "catalog");
  const source = "Captură Öl hors ligne.pcapng";
  const derived = "Dérivé cadru 7.pcapng";
  let app: ElectronApplication | undefined;
  try {
    await mkdir(workbench);
    await mkdir(scripts);
    await catalog(release);
    await writeFile(
      join(workbench, source),
      await readFile(join(here, "../fixtures/wireshark-tshark/sample.pcapng")),
    );
    await run(join(installation, "editcap.exe"), [
      "-r",
      join(workbench, source),
      join(workbench, derived),
      "7",
    ]);
    const { stdout } = await run(join(installation, "tshark.exe"), ["--version"]);
    const version = /^TShark \(Wireshark\) (\d+\.\d+\.\d+)/m.exec(stdout)?.[1];
    if (!version) throw Error("TShark version unavailable.");
    const first = await captureRef(workbench, source, 3, "1767225600.200000000", version, "coap");
    const second = await captureRef(workbench, derived, 1, "1767225600.600000000", version, null);
    const fabricated = `capture:${"f".repeat(64)}#f=1`;
    await writeFile(
      join(scripts, "frame.jsonl"),
      [
        {
          toolCalls: [
            {
              name: "wireshark_capture",
              args: { operation: "query", source: { path: source }, filter: "coap", limit: 1 },
            },
            { name: "wireshark_capture", args: { operation: "frame", source: { path: derived }, frame: 1 } },
          ],
        },
        { text: `Source [[${first}]], derived [[${second}]], unknown [[${fabricated}]].` },
      ]
        .map((step) => JSON.stringify(step))
        .join("\n"),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VERA_TEST_PROGRAMS;
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "Path";
    env[pathKey] = `${installation};${env[pathKey] ?? ""}`;
    app = await _electron.launch({
      executablePath: join(desktop, "../../../node_modules/electron/dist/electron.exe"),
      chromiumSandbox: true,
      args: [desktop, `--user-data-dir=${join(root, "data")}`],
      env: {
        ...env,
        TEMP: root,
        TMP: root,
        VERA_TEST_DIALOG_PATH: workbench,
        VERA_REPLAY_DIR: scripts,
        VERA_TEST_BUNDLED_PLUGINS: release,
      },
    });
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator("#workbench-name").fill("Wireshark offline capture");
    await page.locator('[data-action="create-workbench"]').click();
    await expect(page.locator('[data-action="new-session"]')).toBeVisible();
    const setup = await page.evaluate(async (pluginId) => {
      const vera = (window as unknown as { vera: VeraBridge }).vera;
      try {
        const { config } = await vera.invoke("workbench.config.get", {});
        const { review } = await vera.invoke("plugins.catalogReview", { id: pluginId });
        await vera.invoke("plugins.catalogInstall", { id: pluginId, sha256: review.sha256 });
        await vera.invoke("plugins.toggle", { workbenchId: config.id, id: pluginId, enabled: true });
        return "ready";
      } catch (error) {
        return JSON.stringify(error);
      }
    }, plugin);
    expect(setup).toBe("ready");
    await page.locator('[data-action="new-session"]').click();
    const sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    expect(sessionId).toBeTruthy();
    await page.evaluate(
      (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
          sessionId: id!,
          modelRef: "replay/frame",
        }),
      sessionId,
    );
    const composer = page.getByRole("textbox", { name: "Message", exact: true });
    await composer.fill("Inspect the saved source and derived frame offline.");
    await composer.press("Enter");
    await expect(page.locator('[data-citation-kind="capture"][data-citation="valid"]')).toHaveCount(2, {
      timeout: 30_000,
    });
    await expect(page.locator('[data-citation-kind="capture"][data-citation="invalid"]')).toHaveCount(1);
    const refusal = await page.evaluate(
      async ({ id, ref }) => {
        const vera = (window as unknown as { vera: VeraBridge }).vera;
        const { snapshot } = await vera.invoke("session.get", { sessionId: id! });
        const message = snapshot.items.find((item) => item.kind === "assistant" && item.citations.length);
        if (!message) throw Error("Missing captured citation message.");
        try {
          return await vera.invoke("wireshark.openFrame", { sessionId: id!, messageId: message.id, ref });
        } catch (error) {
          return error;
        }
      },
      { id: sessionId, ref: fabricated },
    );
    expect(refusal).toMatchObject({ messageKey: "wireshark.invalidCitation" });
    expect(await viewerProcess(root, source, "list")).toBe("");

    const openFrame = async (number: number, filter?: string) => {
      await page.getByRole("button", { name: `Open frame ${number} in Wireshark` }).click();
      const dialog = page.getByRole("dialog");
      if (filter) await dialog.getByLabel("Display filter (optional)").fill(filter);
      await dialog.getByRole("button", { name: "Open in Wireshark", exact: true }).click();
      return dialog;
    };
    const sourceDialog = await openFrame(3);
    await expect(sourceDialog).toBeHidden();
    let result = "";
    await expect
      .poll(async () => (result = await viewerProcess(root, source, "inspect")), { timeout: 15_000 })
      .toContain("Frame 3:");
    expect(result).toContain("coap");
    await info.attach("native-source", { body: result, contentType: "text/plain" });
    if (evidence) await writeFile(join(evidence, "windows-source-ui.txt"), result);
    await viewerProcess(root, source, "close");

    const adjusted = await openFrame(1, "arp");
    await expect(adjusted.getByRole("status")).toHaveText(
      "The display filter was adjusted to include frame 1.",
    );
    await expect
      .poll(async () => (result = await viewerProcess(root, derived, "inspect")), { timeout: 15_000 })
      .toContain("Frame 1:");
    expect(result).toContain("(arp) || frame.number == 1");
    await info.attach("native-derived", { body: result, contentType: "text/plain" });
    if (evidence) await writeFile(join(evidence, "windows-derived-ui.txt"), result);
    await viewerProcess(root, derived, "close");
    await adjusted.getByRole("button", { name: "Close" }).click();

    const invalid = await openFrame(3, "(");
    await expect(invalid.getByRole("alert")).toHaveText(
      "Wireshark could not validate this offline display filter.",
    );
    expect(await viewerProcess(root, source, "list")).toBe("");
    await invalid.getByRole("button", { name: "Cancel" }).click();
    await writeFile(join(workbench, source), await readFile(join(workbench, derived)));
    const stale = await openFrame(3);
    await expect(stale.getByRole("alert")).toContainText("The capture file changed.");
    expect(await viewerProcess(root, source, "list")).toBe("");
    await stale.getByRole("button", { name: "Cancel" }).click();
    await rm(join(workbench, derived));
    const missing = await openFrame(1);
    await expect(missing.getByRole("alert")).toContainText("The capture file is missing or inaccessible");
    expect(await viewerProcess(root, derived, "list")).toBe("");
    await expect.poll(() => readdir(join(root, "data", "wireshark-frames"))).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    if (app)
      await Promise.all([source, derived].map((name) => viewerProcess(root, name, "close").catch(() => "")));
    await app?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
