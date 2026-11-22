import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import Database from "better-sqlite3";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

test("native indexed and issued large-text citations cross IPC compactly and keep their verified range", async () => {
  test.setTimeout(120000);
  const evidence = resolve("test-outputs/view03");
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(join(evidence, "citation-owned-"));
  const folder = join(scratch, "bench"),
    scripts = join(scratch, "scripts"),
    profile = join(scratch, "profile");
  for (const path of [folder, scripts, profile]) await mkdir(path);
  const secret = "view03-citation-credential";
  const lines = Array.from({ length: 300 }, (_, i) =>
    i === 249
      ? `CITED 250 ${secret}`
      : i === 250
        ? "CITED 251 verified"
        : `Row ${i + 1} ${"x".repeat(21000)}`,
  );
  const text = `${lines.join("\r\n")}\r\n`,
    path = "citation.txt";
  await writeFile(join(folder, path), text);
  await writeFile(
    join(scripts, "large-citation.jsonl"),
    [
      { toolCalls: [{ name: "read_doc", args: { path, lineStart: 250, lineEnd: 251 } }] },
      { text: "Verified [[citation.txt#L250-L251]]." },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${profile}`],
    env,
    chromiumSandbox: true,
  });
  let currentPage: Page | undefined, sessionId: string | undefined;
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    currentPage = page;
    await invoke(page, "app.settings.update", { language: "en" });
    const bench = await invoke(page, "workbench.create", {
      folder,
      name: "Large citation",
      config: { docs: { include: [], exclude: [] } },
    });
    // Seed only the isolated fixture's verified index; no embedding work or production hook is needed.
    await expect
      .poll(async () => (await invoke(page, "docs.volume", { workbenchId: bench.config.id })).volume, {
        timeout: 15000,
      })
      .not.toBeNull();
    const db = new Database(join(folder, ".vera/vera.db"));
    try {
      const modified = (await stat(join(folder, path))).mtime.toISOString(),
        now = new Date().toISOString();
      const entry = db
        .prepare(
          "INSERT INTO documents(path,kind,sha256,bytes,mtime,pages,status,error,indexed_at) VALUES(?,?,?,?,?,NULL,'indexed',NULL,?)",
        )
        .run(
          path,
          "text",
          createHash("sha256").update(text).digest("hex"),
          Buffer.byteLength(text),
          modified,
          now,
        );
      db.prepare("INSERT INTO document_extractions(doc_id,extraction_json) VALUES(?,?)").run(
        entry.lastInsertRowid,
        JSON.stringify({ kind: "text", lines }),
      );
      const excerpt = `${lines[249]}\n${lines[250]}`;
      db.prepare("INSERT INTO chunks(doc_id,ordinal,locator_json,text,chars) VALUES(?,0,?,?,?)").run(
        entry.lastInsertRowid,
        JSON.stringify({ type: "lines", start: 250, end: 251 }),
        excerpt,
        excerpt.length,
      );
    } finally {
      db.close();
    }
    const hits = await invoke(page, "docs.search", { workbenchId: bench.config.id, query: "CITED" });
    expect(hits.results).toHaveLength(1);
    const generic = await invoke(page, "docs.open", {
      workbenchId: bench.config.id,
      ref: hits.results[0]?.ref ?? "",
      requestId: "generic-large",
    });
    expect(generic.content).toMatchObject({
      kind: "text",
      lines: [],
      start: 250,
      end: 251,
      byteSource: { lines: 300 },
    });
    expect(JSON.stringify(generic).length).toBeLessThan(4096);
    const session = await invoke(page, "session.create", {
      workbenchId: bench.config.id,
      modelRef: "replay/large-citation",
    });
    sessionId = session.id;
    await page.reload();
    await page.locator(`[data-session="${session.id}"]`).click();
    await invoke(page, "session.send", { sessionId: session.id, text: "cite large text" });
    const chip = page.locator('[data-citation="valid"]');
    await expect(chip).toHaveCount(1, { timeout: 20000 });
    await chip.click();
    const panel = page.locator("[data-source-current]"),
      large = panel.locator("[data-large-text]");
    await expect(large.locator('[data-line="250"][aria-current="true"]')).toContainText(
      `CITED 250 ${secret}`,
      { timeout: 20000 },
    );
    await expect(large.locator('[data-line="251"]')).toHaveAttribute("aria-current", "true");
    await expect(panel.locator("[data-text-cancel]")).toHaveCount(0);
    const geometry = await large.locator('[data-line="250"]').evaluate((node) => {
      const body = node.closest(".document-body");
      return {
        top: node.getBoundingClientRect().top - (body?.getBoundingClientRect().top ?? 0),
        height: body?.clientHeight ?? 0,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeLessThan(geometry.height);
    await panel.press("Control+f");
    await panel.locator("[data-document-search]").fill("CITED");
    await expect(panel.locator("[data-document-find]")).toContainText("1 of 2", { timeout: 20000 });
    await panel.locator("[data-document-search]").press("Shift+Enter");
    await expect(panel.locator("[data-document-find]")).toContainText("2 of 2", { timeout: 20000 });
    await panel.locator("[data-document-search]").press("Enter");
    await expect(panel.locator("[data-document-find]")).toContainText("1 of 2", { timeout: 20000 });
    await panel.locator("[data-document-search]").press("Escape");
    await expect(large.locator(".document-body")).toBeFocused();
    await large.locator(".document-body").press("Control+g");
    await expect(panel.locator("[data-document-goto]")).toBeFocused();
    await panel.locator("[data-document-goto]").press("Escape");
    await expect(large.locator(".document-body")).toBeFocused();
    await invoke(page, "mqtt.credentials.save", {
      ref: "view03-citation",
      password: secret,
      storageConsent: true,
    });
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await expect(large.locator('[data-line="250"][aria-current="true"]')).toContainText(
      "*".repeat(secret.length),
    );
    await expect(large).not.toContainText(secret);
    await page.screenshot({ path: join(evidence, "native-citation.png") });
    await writeFile(
      join(evidence, "native-citation-receipt.json"),
      JSON.stringify(
        {
          bytes: Buffer.byteLength(text),
          genericReplyBytes: JSON.stringify(generic).length,
          range: [250, 251],
          geometry,
          indexedAndIssued: true,
          countsWrapFocus: true,
          liveDisplay: true,
        },
        null,
        2,
      ),
    );
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    if (currentPage && sessionId) {
      await currentPage.screenshot({ path: join(evidence, "native-citation-last.png") }).catch(() => {});
      const snapshot = await invoke(currentPage, "session.get", { sessionId }).catch(() => undefined);
      await writeFile(join(evidence, "native-citation-session.json"), JSON.stringify(snapshot, null, 2));
    }
    await app.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
