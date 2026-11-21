import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

test("Display masking preserves MQTT-named Files, Find identity, live choices and persisted tabs", async () => {
  test.setTimeout(180000);
  const evidence = resolve("test-outputs/mask02/native");
  await mkdir(evidence, { recursive: true });
  const scratch = await realpath(await mkdtemp(join(evidence, "owned-")));
  const scripts = join(scratch, "scripts");
  await mkdir(scripts);
  await writeFile(
    join(scripts, "prefix.jsonl"),
    [
      JSON.stringify({
        match: "(?i)mask02 prefix citation",
        toolCalls: [{ name: "read", args: { path: "__vera_display_notes/child.txt" } }],
      }),
      JSON.stringify({ text: "Prefix source [[__vera_display_notes/child.txt#L1-L1]]." }),
    ].join("\n"),
  );
  const folder = join(scratch, "bench"),
    other = join(scratch, "other"),
    profile = join(scratch, "profile");
  await Promise.all([join(folder, "docs"), other, profile].map((path) => mkdir(path, { recursive: true })));
  const secrets = ["mask02-mqtt-first-credential", "mask02-mqtt-second-credential"];
  for (const [i, secret] of secrets.entries())
    await writeFile(
      join(folder, "docs", `${secret}.txt`),
      `${i === 0 ? "FIRST" : "SECOND"} ${secret}\nneedle\n`,
    );
  await writeFile(join(other, `${secrets[0]}.log`), `OTHER ${secrets[0]}`);
  await mkdir(join(folder, "__vera_display_notes"));
  await writeFile(join(folder, "__vera_display_notes/child.txt"), "PREFIX_OK");
  await writeFile(join(profile, "protected.txt"), "PROTECTED");
  await symlink(profile, join(folder, "protected-alias"), process.platform === "win32" ? "junction" : "dir");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  const launch = () =>
    _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${profile}`],
      env,
      chromiumSandbox: true,
    });
  let app = await launch();
  const receipts: unknown[] = [];
  try {
    await installNetworkGuard(app);
    let page = await app.firstWindow();
    await page.waitForLoadState("load");
    await invoke(page, "app.settings.update", { language: "en" });
    for (const [i, password] of secrets.entries()) {
      const saved = await invoke(page, "mqtt.credentials.save", {
        ref: `mask02-${i}`,
        password,
        storageConsent: true,
      });
      expect(saved.status).toBe("saved");
    }
    const bench = await invoke(page, "workbench.create", {
      folder,
      name: "Masking",
      config: { docs: { include: ["docs/**"], exclude: [] } },
    });
    const workbenchId = bench.config.id;
    const session = await invoke(page, "session.create", { workbenchId, modelRef: "replay/prefix" });
    await invoke(page, "session.send", { sessionId: session.id, text: "mask02 prefix citation" });
    await expect
      .poll(
        async () =>
          (await invoke(page, "session.get", { sessionId: session.id })).snapshot.items.filter(
            (item) =>
              item.kind === "assistant" &&
              !item.streaming &&
              item.citations.some((citation) => citation.valid),
          ).length,
      )
      .toBe(1);
    const snapshot = (await invoke(page, "session.get", { sessionId: session.id })).snapshot;
    const cited = snapshot.items.find(
      (item) =>
        item.kind === "assistant" && !item.streaming && item.citations.some((citation) => citation.valid),
    );
    if (cited?.kind !== "assistant") throw Error("Missing verified prefix citation");
    const citation = await invoke(page, "docs.open", {
      workbenchId,
      sessionId: session.id,
      messageId: cited.id,
      ref: "__vera_display_notes/child.txt#L1-L1",
    });
    expect(citation.content).toMatchObject({ lines: ["PREFIX_OK"] });
    receipts.push({
      savedMqtt: (await invoke(page, "mqtt.credentials.list", {})).credentials,
      workbenchId,
      session,
    });
    const rootListing = await invoke(page, "docs.tree", { workbenchId, path: "" });
    const prefixFolder = rootListing.entries.find((entry) => entry.name === "__vera_display_notes");
    if (!prefixFolder) throw Error("Missing ordinary prefix folder");
    const prefixListing = await invoke(page, "docs.tree", { workbenchId, path: prefixFolder.path });
    const prefixChild = prefixListing.entries[0];
    if (!prefixChild) throw Error("Missing ordinary prefix child");
    expect((await invoke(page, "docs.read", { workbenchId, path: prefixChild.path })).content).toMatchObject({
      lines: ["PREFIX_OK"],
    });
    const findOff = await invoke(page, "docs.find", { workbenchId, query: "mask02" });
    expect(findOff.paths).toHaveLength(2);
    const treeOff = await invoke(page, "docs.tree", { workbenchId, path: "docs" });
    expect(treeOff.entries.map((entry) => entry.name)).toEqual(secrets.map((secret) => `${secret}.txt`));
    await expect
      .poll(
        async () => (await invoke(page, "docs.list", { workbenchId })).documents.map((doc) => doc.status),
        { timeout: 60000 },
      )
      .toEqual(["indexed", "indexed"]);
    const indexedOff = await invoke(page, "docs.search", { workbenchId, query: "needle" });
    expect(indexedOff.results).toHaveLength(2);
    const first = treeOff.entries[0],
      second = treeOff.entries[1];
    if (!first || !second) throw Error("Missing fixture entries");
    expect((await invoke(page, "docs.read", { workbenchId, path: first.path })).content).toMatchObject({
      lines: [`FIRST ${secrets[0]}`, "needle", ""],
    });
    await page.reload();
    await page.locator(`[data-session="${session.id}"]`).click();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    const docs = () => page.locator("#panel-docs");
    await docs().locator('[data-tree-path="docs"]').click();
    await docs().locator(`[data-tree-path="${first.path}"]`).click();
    await expect(page.locator("[data-source-current]")).toContainText(`FIRST ${secrets[0]}`);
    await docs().locator(`[data-tree-path="${second.path}"]`).click();
    await expect(page.locator("[data-source-current]")).toContainText(`SECOND ${secrets[1]}`);
    const alternateSession = await invoke(page, "session.create", { workbenchId });
    await page.locator(`[data-session="${alternateSession.id}"]`).click();
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await page.locator(`[data-session="${session.id}"]`).click();
    await expect(page.locator("[data-source-current]")).toContainText(
      `SECOND ${"*".repeat(secrets[1]?.length ?? 0)}`,
    );
    await expect(page.locator("[data-document-tabs]")).not.toContainText("mask02-mqtt");
    await page.locator(`[data-tab-key="file:${first.path}"]`).click();
    await expect(page.locator("[data-source-current]")).toContainText(
      `FIRST ${"*".repeat(secrets[0]?.length ?? 0)}`,
    );
    await expect(page.locator("[data-source-current]")).not.toContainText(secrets[0] as string);
    await expect(docs().locator(`[data-tree-path="${first.path}"] .tree-name`)).toHaveText("[REDACTED].txt");
    await expect(docs().locator(`[data-tree-path="${second.path}"] .tree-name`)).toHaveText("[REDACTED].txt");
    const findOn = await invoke(page, "docs.find", { workbenchId, query: "mask02" });
    expect(findOn.paths).toEqual(findOff.paths);
    expect(JSON.stringify(findOn)).not.toContain("mask02-mqtt");
    const indexedOn = await invoke(page, "docs.search", { workbenchId, query: "needle" });
    expect(indexedOn.results.map((hit) => hit.ref)).toEqual(indexedOff.results.map((hit) => hit.ref));
    expect(JSON.stringify(indexedOn)).not.toContain("mask02-mqtt");
    const indexed = indexedOn.results[0];
    if (!indexed) throw Error("Missing indexed hit");
    expect((await invoke(page, "docs.open", { workbenchId, ref: indexed.ref })).content.ref).toBe(
      indexed.ref,
    );
    await docs().locator("[data-docs-search]").fill("mask02");
    await expect(docs().locator('[role="treeitem"][data-tree-type="file"]')).toHaveCount(2);
    await docs().locator(`[data-tree-path="${second.path}"]`).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-source-current]")).toContainText(
      `SECOND ${"*".repeat(secrets[1]?.length ?? 0)}`,
    );
    await expect(page.locator('[data-document-tabs] [data-tab-key^="file:"]')).toHaveCount(2);
    expect(
      (
        await invoke(page, "mqtt.credentials.save", {
          ref: "mask02-short",
          password: "on",
          storageConsent: true,
        })
      ).status,
    ).toBe("saved");
    await invoke(page, "workbench.config.update", {
      workbenchId,
      patch: { privacy: { mask: { display: "off" } } },
    });
    await expect(page.locator("[data-source-current]")).toContainText(`SECOND ${secrets[1]}`);
    await invoke(page, "workbench.config.update", {
      workbenchId,
      patch: { privacy: { mask: { display: "on" } } },
    });
    await invoke(page, "app.settings.update", { privacy: { mask: { display: false } } });
    await expect(page.locator("[data-source-current]")).toContainText(
      `SECOND ${"*".repeat(secrets[1]?.length ?? 0)}`,
    );
    const refused = async (path: string) => {
      try {
        await invoke(page, "docs.read", { workbenchId, path });
        return "unexpected";
      } catch (error) {
        return String(error);
      }
    };
    expect(await refused("../profile/protected.txt")).not.toBe("unexpected");
    expect(await refused("protected-alias/protected.txt")).not.toBe("unexpected");
    expect(await refused(`${first.path.slice(0, -4)}abcd`)).not.toBe("unexpected");
    const laterSecrets = ["mask02-later-alpha-key", "mask02-later-beta-key"];
    for (const [i, value] of laterSecrets.entries())
      await writeFile(join(folder, `${value}.log`), `${i === 0 ? "LATER_FIRST" : "LATER_SECOND"} ${value}`);
    await docs().locator("[data-docs-search]").fill("mask02-later");
    await expect(docs().locator('[role="treeitem"][data-tree-type="file"]')).toHaveCount(2);
    for (const value of laterSecrets) await docs().locator(`[data-tree-path="${value}.log"]`).click();
    for (const [i, password] of laterSecrets.entries())
      expect(
        (
          await invoke(page, "mqtt.credentials.save", {
            ref: `mask02-later-${i}`,
            password,
            storageConsent: true,
          })
        ).status,
      ).toBe("saved");
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await expect(page.locator("[data-source-current]")).toContainText(
      `LATER_SECOND ${"*".repeat(laterSecrets[1]?.length ?? 0)}`,
    );
    await expect(page.locator("[data-document-tabs]")).not.toContainText("mask02-later");
    await page.locator(`[data-tab-key="file:${second.path}"]`).click();
    await expect(page.locator("[data-source-current]")).toContainText(
      `SECOND ${"*".repeat(secrets[1]?.length ?? 0)}`,
    );
    await expect
      .poll(() =>
        page.evaluate(
          ({ workbenchId, sessionId }) =>
            JSON.parse(localStorage.getItem(`vera.tabs.${workbenchId}.${sessionId}`) ?? "null")?.active,
          { workbenchId, sessionId: session.id },
        ),
      )
      .toBe(`file:${second.path}`);
    const before = await page.evaluate(
      ({ workbenchId, sessionId }) =>
        JSON.parse(localStorage.getItem(`vera.tabs.${workbenchId}.${sessionId}`) ?? "null"),
      { workbenchId, sessionId: session.id },
    );
    expect(JSON.stringify(before)).not.toContain("mask02-mqtt");
    receipts.push({ off: findOff, on: findOn, persisted: before, outbound: await outboundAttempts(app) });
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch();
    await installNetworkGuard(app);
    page = await app.firstWindow();
    await page.waitForLoadState("load");
    await invoke(page, "workbench.open", { folder });
    const afterRead = await invoke(page, "docs.read", { workbenchId, path: second.path });
    expect(afterRead.content).toMatchObject({ lines: ["SECOND [REDACTED]", "needle", ""] });
    await page.reload();
    const selectedSession = page.locator(`[data-session="${session.id}"]`);
    await selectedSession.click();
    await expect(page.locator("[data-source-current]")).toContainText(
      `SECOND ${"*".repeat(secrets[1]?.length ?? 0)}`,
    );
    await expect(page.locator("[data-document-tabs]")).not.toContainText("mask02-later");
    const reopenedTree = await invoke(page, "docs.tree", { workbenchId, path: "docs" });
    expect(reopenedTree.entries.map((entry) => entry.path)).toEqual(
      treeOff.entries.map((entry) => entry.path),
    );
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await invoke(page, "workbench.close", {});
    const otherBench = await invoke(page, "workbench.create", {
      folder: other,
      name: "Other",
      config: { privacy: { mask: { display: "off" } } },
    });
    let foreign = false;
    try {
      await invoke(page, "docs.read", { workbenchId: otherBench.config.id, path: first.path });
    } catch {
      foreign = true;
    }
    expect(foreign).toBe(true);
    const otherFound = await invoke(page, "docs.find", {
      workbenchId: otherBench.config.id,
      query: "mask02",
    });
    expect(otherFound.paths).toHaveLength(1);
    expect(Object.values(otherFound.labels ?? {})).toContain(`${secrets[0]}.log`);
    const otherPath = otherFound.paths[0];
    if (!otherPath) throw Error("Missing other workbench file");
    expect(
      (await invoke(page, "docs.read", { workbenchId: otherBench.config.id, path: otherPath })).content,
    ).toMatchObject({ lines: [`OTHER ${secrets[0]}`] });
    receipts.push({
      restarted: true,
      foreignRefused: foreign,
      keyFormat: JSON.parse(await readFile(join(profile, "display-identities.json"), "utf8")).schemaVersion,
    });
    await writeFile(join(evidence, "receipts.json"), JSON.stringify(receipts, null, 2));
  } finally {
    await app.close();
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
