// REQ-UX-b93197aa, REQ-FUNC-4c3f4f0c, REQ-SEC-1a37ade3, REQ-DATA-fd1933a1
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("native approved PDF download opens locally, persists offline and rejects failed/revoked transfers", async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "vera-pdf-native-"));
  const folder = join(root, "bench"),
    scripts = join(root, "scripts");
  await mkdir(folder);
  await mkdir(scripts);
  const bytes = await readFile(
    resolve("tests/fixtures/workbenches/demo-board/docs/vera-demo-01-reference-manual.pdf"),
  );
  for (const [name, path] of [
    ["download", "redirect.pdf"],
    ["bad", "bad.pdf"],
    ["slow", "slow.pdf"],
  ] as const)
    await writeFile(
      join(scripts, `${name}.jsonl`),
      [
        {
          toolCalls: [
            {
              name: "web_download",
              args: { url: `http://downloads.example.org/${path}`, filename: "reference.pdf" },
            },
          ],
        },
        { text: "PDF request finished." },
      ]
        .map((step) => JSON.stringify(step))
        .join("\n"),
    );
  const requests: { path: string; authorization: string | undefined; cookie: string | undefined }[] = [];
  const server = createServer((request, response) => {
    requests.push({
      path: request.url ?? "",
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    if (request.url === "/redirect.pdf") {
      response.writeHead(302, { location: "http://downloads.example.org/reference.pdf" }).end();
      return;
    }
    if (request.url === "/bad.pdf") {
      response.writeHead(200, { "content-type": "application/pdf" }).end("<html>Not a PDF</html>");
      return;
    }
    if (request.url === "/slow.pdf") {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.write("%PDF-1.7\n");
      return;
    }
    response.writeHead(200, { "content-type": "application/pdf", "content-length": bytes.length }).end(bytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing fixture port");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VERA_TEST_ALLOW_WRITES;
  env.VERA_REPLAY_DIR = scripts;
  const launch = () =>
    _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
      env,
    });
  let app = await launch();
  try {
    await installNetworkGuard(app);
    // Only this test maps a validated public source to an owned loopback HTTP fixture.
    await app.evaluate((_electron, base) => {
      const dns = process.getBuiltinModule("node:dns/promises"),
        originalLookup = dns.lookup;
      dns.lookup = ((hostname: string, ...args: unknown[]) =>
        hostname === "downloads.example.org"
          ? Promise.resolve([{ address: "93.184.215.14", family: 4 }])
          : Reflect.apply(originalLookup, dns, [hostname, ...args])) as typeof dns.lookup;
      const http = process.getBuiltinModule("node:http"),
        original = http.request;
      http.request = ((...args: unknown[]) => {
        const input = args[0];
        if (input instanceof URL && input.hostname === "downloads.example.org")
          args[0] = new URL(input.pathname + input.search, base);
        return Reflect.apply(original, http, args);
      }) as typeof http.request;
      process.getBuiltinModule("node:module").syncBuiltinESMExports();
    }, `http://127.0.0.1:${address.port}`);
    const page = await app.firstWindow();
    const ids = await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const bench = await api.invoke("workbench.create", { folder, name: "PDF research" });
      const session = await api.invoke("session.create", { modelRef: "replay/download", mode: "ask" });
      return { workbenchId: bench.config.id, sessionId: session.id };
    }, folder);
    await page.reload();
    await page.locator(`[data-session="${ids.sessionId}"]`).click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Download the reference manual PDF.");
    await page.getByRole("textbox", { name: "Message", exact: true }).press("Enter");
    const approval = page.locator("[data-approval-card]");
    await expect(approval).toContainText("Download from:");
    await expect(approval).toContainText("100 MiB");
    expect(requests).toEqual([]);
    await approval.getByRole("button", { name: "Approve", exact: true }).click();
    const open = page.getByRole("button", { name: "Open PDF: reference.pdf", exact: true });
    await expect(open).toBeVisible();
    const records = await page.evaluate(async (workbenchId) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      return (await api.invoke("downloads.list", { workbenchId })).downloads;
    }, ids.workbenchId);
    expect(records).toHaveLength(1);
    const record = records[0];
    if (!record) throw Error("Missing saved PDF");
    expect(record.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(record.finalUrl).toBe("http://downloads.example.org/reference.pdf");
    expect(await readFile(join(folder, record.path))).toEqual(bytes);
    expect(existsSync(join(folder, "docs"))).toBe(false);
    expect(requests.map((request) => request.path)).toEqual(["/redirect.pdf", "/reference.pdf"]);
    expect(requests.every((request) => !request.authorization && !request.cookie)).toBe(true);
    await open.click();
    await expect(page.locator(".pdf-viewer[data-ready=true]")).toBeVisible();
    await expect(page.locator("dialog[open]")).not.toContainText("Cited pages");
    const centered = await page.locator("dialog[open]").boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(centered).not.toBeNull();
    if (centered) {
      expect(Math.abs(centered.x + centered.width / 2 - viewport.width / 2)).toBeLessThan(3);
      expect(Math.abs(centered.y + centered.height / 2 - viewport.height / 2)).toBeLessThan(3);
    }
    await expect(page.locator(".pdf-viewer")).toHaveAttribute("data-page", "1");
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.locator(".pdf-viewer[data-ready=true]")).toHaveAttribute("data-page", "2");
    if (process.env.VERA_PDF_SCREENSHOT) await page.screenshot({ path: process.env.VERA_PDF_SCREENSHOT });
    await page.locator("dialog[open]").press("Escape");
    await expect(open).toBeFocused();
    if (process.env.VERA_PDF_SCREENSHOT)
      await page.screenshot({ path: process.env.VERA_PDF_SCREENSHOT.replace(".png", "-card.png") });
    for (const [language, label] of [
      ["ro", "Deschide PDF: reference.pdf"],
      ["de", "PDF öffnen: reference.pdf"],
      ["en", "Open PDF: reference.pdf"],
    ] as const) {
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="language"]').click();
      await page.locator("#language").selectOption(language);
      await page.locator('[data-action="leave-settings"]').click();
      await page.locator(`[data-session="${ids.sessionId}"]`).click();
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await page.locator('[aria-controls="right-panel"]').click();
    await page.locator("#tab-docs").click();
    await expect(page.getByRole("heading", { name: "Downloaded PDFs" })).toBeVisible();
    const indexed = await page.evaluate(
      async (workbenchId) =>
        (await (window as unknown as { vera: VeraBridge }).vera.invoke("docs.list", { workbenchId }))
          .documents,
      ids.workbenchId,
    );
    expect(indexed).toEqual([]);
    const run = async (model: string) =>
      page.evaluate(async (model) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        const session = await api.invoke("session.create", { modelRef: model, mode: "bypass" });
        await api.invoke("session.send", { sessionId: session.id, text: "Download PDF" });
        return session.id;
      }, model);
    const bad = await run("replay/bad");
    await expect
      .poll(async () =>
        page.evaluate(
          async (sessionId) =>
            (await (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId }))
              .snapshot.status,
          bad,
        ),
      )
      .toBe("idle");
    const slow = await run("replay/slow");
    await expect.poll(() => requests.some((request) => request.path === "/slow.pdf")).toBe(true);
    await page.evaluate(async () =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("web.access.save", {
        enabled: false,
        provider: "exa",
        authentication: "anonymous",
      }),
    );
    await expect
      .poll(async () =>
        page.evaluate(
          async (sessionId) =>
            (await (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId }))
              .snapshot.status,
          slow,
        ),
      )
      .toBe("idle");
    expect(
      await page.evaluate(
        async (workbenchId) =>
          (await (window as unknown as { vera: VeraBridge }).vera.invoke("downloads.list", { workbenchId }))
            .downloads.length,
        ids.workbenchId,
      ),
    ).toBe(1);
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch();
    await installNetworkGuard(app);
    const reopened = await app.firstWindow();
    const offline = await reopened.evaluate(
      async ({ folder, workbenchId, downloadId }) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        await api.invoke("workbench.open", { folder });
        const content = await api.invoke("downloads.open", { workbenchId, downloadId });
        const web = await api.invoke("web.access.get", {});
        const stale = await api
          .invoke("downloads.open", { workbenchId: `wb_${"0".repeat(26)}`, downloadId })
          .then(
            () => "allowed",
            (error) => error.code,
          );
        return {
          pages: content.content.kind === "pdf" ? content.content.pages.length : 0,
          enabled: web.preferences.enabled,
          stale,
        };
      },
      { folder, workbenchId: ids.workbenchId, downloadId: record.downloadId },
    );
    expect(offline).toEqual({ pages: record.pages, enabled: false, stale: "CONFLICT" });
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
