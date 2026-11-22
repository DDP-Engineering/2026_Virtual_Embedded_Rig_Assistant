import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, type CDPSession, expect, type Page, test } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { LARGE_TEXT_BYTES, LARGE_TEXT_SECRET, makeLargeTextFixture } from "../support/large-text-fixture.js";
import { rendererUrlFromOutput } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const evidence = resolve("test-outputs/view03");
const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

async function acceptance(page: Page, cdp: CDPSession, platform: string, target: number) {
  const panel = page.locator("[data-source-current]");
  const large = panel.locator("[data-large-text]");
  const heaps: { stage: string; used: number }[] = [];
  let peak = 0,
    gaps: number[] = [];
  await cdp.send("Performance.enable");
  await page.evaluate(() => {
    const state = { gaps: [] as number[], last: performance.now(), timer: 0 };
    state.timer = window.setInterval(() => {
      const now = performance.now();
      state.gaps.push(now - state.last);
      state.last = now;
    }, 25);
    Object.assign(window, { view03Pulse: state });
  });
  const sample = async (stage: string) => {
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    heaps.push({ stage, used: heap.usedSize });
  };
  const timer = setInterval(() => {
    void cdp
      .send("Runtime.getHeapUsage")
      .then((value) => {
        peak = Math.max(peak, value.usedSize);
      })
      .catch(() => {});
  }, 150);
  const started = Date.now();
  try {
    await page.locator('[data-tree-path="large.log"]').click({ timeout: 10000 });
    await expect(panel.locator('[data-line="1"]')).toContainText("Row 00000001");
    const firstScreenMs = Date.now() - started;
    console.log(`${platform}: first screen ${firstScreenMs}ms`);
    // The repository defers a calibrated session budget; retain an explicit upper guard and raw latency.
    expect(firstScreenMs).toBeLessThan(2000);
    await sample("first");
    await panel.press("Control+g");
    await panel.locator("[data-document-goto]").fill(String(target));
    await panel.locator("[data-document-goto]").press("Enter");
    await expect(large).toHaveAttribute("data-exact", "false");
    await expect(large.locator(`[data-line="${target}"]`)).toContainText(
      `Row ${String(target).padStart(8, "0")}`,
      { timeout: 90000 },
    );
    await expect(panel.locator("[data-text-cancel]")).toHaveCount(0, { timeout: 90000 });
    console.log(`${platform}: unindexed Go to line settled`);
    await sample("progressive-goto");
    const seek = async (offset: number) => {
      await large.locator("[data-byte-scroll]").evaluate((node, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(node, String(value));
        node.dispatchEvent(new Event("input", { bubbles: true }));
      }, offset);
      await expect(large).toHaveAttribute("data-exact", "true", { timeout: 90000 });
      await expect(panel.locator("[data-text-cancel]")).toHaveCount(0, { timeout: 90000 });
      expect(Number(await large.getAttribute("data-window-bytes"))).toBeLessThanOrEqual(4 * 65536);
      expect(Number(await large.getAttribute("data-index-checkpoints"))).toBeLessThanOrEqual(1026);
      expect(await large.locator("[data-line]").count()).toBeLessThan(180);
    };
    await seek(LARGE_TEXT_BYTES / 3);
    console.log(`${platform}: third offset settled`);
    await sample("third");
    await seek((LARGE_TEXT_BYTES * 2) / 3);
    console.log(`${platform}: two-thirds offset settled`);
    await sample("two-thirds");
    await seek(LARGE_TEXT_BYTES);
    console.log(`${platform}: end settled`);
    await expect(large).toContainText("VIEW03 LATE café 😀");
    await sample("end");
    await large.locator(".document-body").press("Control+Home");
    await expect(large.locator('[data-line="1"]')).toContainText("Row 00000001");
    await panel.press("Control+f");
    await panel.locator("[data-document-search]").fill("VIEW03 LATE café 😀");
    await expect(large.locator("[data-search-match]").first()).toHaveText("VIEW03 LATE café 😀", {
      timeout: 90000,
    });
    await expect(panel.locator("[data-text-cancel]")).toHaveCount(0, { timeout: 90000 });
    await sample("late-find");
    console.log(`${platform}: late Find settled`);
    await panel.press("Control+g");
    await panel.locator("[data-document-goto]").fill(String(target));
    await panel.locator("[data-document-goto]").press("Enter");
    await expect(large.locator(`[data-line="${target}"]`)).toContainText(
      `Row ${String(target).padStart(8, "0")}`,
      { timeout: 90000 },
    );
    await expect(large).toHaveAttribute("data-exact", "true");
    await expect(panel.locator("[data-text-cancel]")).toHaveCount(0, { timeout: 90000 });
    const geometry = await large.locator(`[data-line="${target}"]`).evaluate((node) => {
      const body = node.closest(".document-body");
      return {
        top: node.getBoundingClientRect().top - (body?.getBoundingClientRect().top ?? 0),
        height: body?.clientHeight ?? 0,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeLessThan(geometry.height);
    await panel.press("Control+f");
    await panel.locator("[data-document-search]").fill("VIEW03 absent result");
    await expect(panel.locator("[data-text-cancel]")).toBeVisible();
    await panel.locator("[data-text-cancel]").click();
    const cancelledAt = await large.getAttribute("data-byte-offset");
    await page.waitForTimeout(300);
    expect(await large.getAttribute("data-byte-offset")).toBe(cancelledAt);
    await sample("cancelled");
    await panel.locator("[data-document-search]").fill("VIEW03 LATE café 😀");
    await expect(large.locator("[data-search-match]").first()).toHaveText("VIEW03 LATE café 😀", {
      timeout: 90000,
    });
    await expect(panel.locator("[data-text-cancel]")).toHaveCount(0, { timeout: 90000 });
    await sample("repeated-full-find");
    await panel.locator("[data-document-search]").fill("LONG_COLUMN_MATCH café 😀");
    await expect(large.locator("[data-search-match]").first()).toHaveText("LONG_COLUMN_MATCH café 😀", {
      timeout: 90000,
    });
    await expect(panel.locator("[data-text-cancel]")).toHaveCount(0, { timeout: 90000 });
    const matchGeometry = async () =>
      large.locator("[data-current-search-match]").evaluate((node) => {
        const body = node.closest(".document-body");
        const found = node.getBoundingClientRect(),
          bounds = body?.getBoundingClientRect();
        return {
          left: found.left,
          right: found.right,
          top: found.top,
          bottom: found.bottom,
          bounds: bounds
            ? { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }
            : null,
        };
      });
    const visibleMatch = async () => {
      const { left, right, top, bottom, bounds } = await matchGeometry();
      return (
        !!bounds &&
        left >= bounds.left - 1 &&
        right <= bounds.right + 1 &&
        top >= bounds.top - 1 &&
        bottom <= bounds.bottom + 1
      );
    };
    console.log(`${platform}: long-line geometry ${JSON.stringify(await matchGeometry())}`);
    await expect.poll(visibleMatch).toBe(true);
    await panel.locator(".viewer-toolbar-controls [data-text-wrap]").check();
    await expect.poll(visibleMatch).toBe(true);
    await sample("six-MiB-line-match");
    const baseline = heaps[0]?.used ?? 0;
    gaps = await page.evaluate(() => {
      const state = (window as unknown as { view03Pulse: { timer: number; gaps: number[] } }).view03Pulse;
      clearInterval(state.timer);
      return state.gaps;
    });
    // Screenshot capture is diagnostic; functional geometry and heap bounds are asserted independently.
    await page
      .screenshot({ path: join(evidence, `${platform}-large.png`), timeout: 5000 })
      .catch(async (error: Error) => {
        await writeFile(join(evidence, `${platform}-screenshot-error.txt`), error.message);
      });
    await writeFile(
      join(evidence, `${platform}-receipt.json`),
      JSON.stringify(
        {
          platform,
          bytes: LARGE_TEXT_BYTES,
          firstScreenMs,
          budgetStatus: "Calibration explicitly deferred by PERF policy; 2000ms diagnostic guard only",
          target,
          geometry,
          heaps,
          peak,
          maxPulseGapMs: Math.max(...gaps),
          gaps,
          cancelledAt,
          peakGuardBytes: (platform === "native" ? 256 : 96) * 1024 * 1024,
        },
        null,
        2,
      ),
    );
    expect(Math.max(...heaps.map((value) => value.used)) - baseline).toBeLessThan(32 * 1024 * 1024);
    expect(peak - baseline).toBeLessThan((platform === "native" ? 256 : 96) * 1024 * 1024);
    expect(Math.max(...gaps)).toBeLessThan(750);
  } finally {
    clearInterval(timer);
  }
}

test("browser genuine200MiB log navigation, late Find, Go to line and bounded memory", async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(join(evidence, "browser-owned-"));
  const fixture = await makeLargeTextFixture(join(scratch, "large.log"));
  const handle = await open(join(scratch, "large.log"), "r");
  const server = spawn(process.execPath, ["../02_Tools/environment/dev-renderer.mjs"], {
    env: { ...process.env, VITE_API: "mock" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await expect.poll(() => output, { timeout: 25000 }).toContain("VERA_RENDERER_READY");
    await page.route("**/api/index.ts*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: `${await response.text()}
        const view03Invoke = api.invoke.bind(api);
        api.invoke = async (channel, input) => {
          if (channel === 'docs.tree' && (input.path ?? '') === '') {
            const result = await view03Invoke(channel, input);
            return {...result, entries: [...result.entries, {name:'large.log',path:'large.log',type:'file',ignored:false}]};
          }
          if ((channel === 'docs.readBytes' || channel === 'docs.stat') && input.path === 'large.log') {
            return fetch('/view03-bytes?'+new URLSearchParams({...input, channel})).then(r=>r.json());
          }
          return view03Invoke(channel,input);
        };`,
      });
    });
    await page.route("**/view03-bytes?*", async (route) => {
      const parameters = new URL(route.request().url()).searchParams;
      const workbenchId = parameters.get("workbenchId"),
        path = "large.log";
      if (parameters.get("channel") === "docs.stat") {
        await route.fulfill({
          json: {
            workbenchId,
            properties: {
              path,
              type: "file",
              extension: ".log",
              rendered: false,
              size: fixture.size,
              modified: "2026-11-17T00:00:00.000Z",
            },
          },
        });
      } else {
        const offset = Number(parameters.get("offset")),
          length = Number(parameters.get("length"));
        expect(length).toBeLessThanOrEqual(1048576);
        const buffer = Buffer.alloc(Math.min(length, fixture.size - offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        await route.fulfill({
          json: {
            workbenchId,
            path,
            size: fixture.size,
            offset,
            data: buffer.subarray(0, bytesRead).toString("base64"),
          },
        });
      }
    });
    await page.goto(`${rendererUrlFromOutput(output)}?mock=chat`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    await acceptance(page, await context.newCDPSession(page), "browser", fixture.target);
    expect(errors).toEqual([]);
  } finally {
    await page.screenshot({ path: join(evidence, "browser-last.png"), timeout: 5000 }).catch(() => {});
    await handle.close();
    if (server.exitCode === null) {
      const stopped = once(server, "exit");
      server.kill("SIGKILL");
      await stopped;
    }
    await writeFile(join(evidence, "browser-server.log"), output);
    await rm(scratch, { recursive: true, force: true });
  }
});

test("native genuine200MiB confined log with bounded navigation and live Display refresh", async () => {
  test.setTimeout(240000);
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(join(evidence, "native-owned-"));
  const folder = join(scratch, "bench"),
    profile = join(scratch, "profile");
  await mkdir(folder);
  await mkdir(profile);
  const fixture = await makeLargeTextFixture(join(folder, "large.log"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${profile}`],
    env,
    chromiumSandbox: true,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await invoke(page, "app.settings.update", { language: "en" });
    const bench = await invoke(page, "workbench.create", {
      folder,
      name: "VIEW03",
      config: { docs: { include: [], exclude: [] } },
    });
    const session = await invoke(page, "session.create", { workbenchId: bench.config.id });
    await page.reload();
    await page.locator(`[data-session="${session.id}"]`).click();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    await acceptance(page, await page.context().newCDPSession(page), "native", fixture.target);
    expect(
      (
        await invoke(page, "mqtt.credentials.save", {
          ref: "view03",
          password: LARGE_TEXT_SECRET,
          storageConsent: true,
        })
      ).status,
    ).toBe("saved");
    const panel = page.locator("[data-source-current]"),
      large = panel.locator("[data-large-text]");
    await large.locator(".document-body").press("Control+Home");
    await expect(large.locator('[data-line="1"]')).toContainText(LARGE_TEXT_SECRET);
    await page.locator("[data-source-current]").press("Control+f");
    await page.locator("[data-document-search]").fill("VIEW03 absent during Display change");
    await expect(panel.locator("[data-text-cancel]")).toBeVisible();
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await expect(large).not.toContainText(LARGE_TEXT_SECRET);
    await expect(large.locator('[data-line="1"]')).toContainText("*".repeat(LARGE_TEXT_SECRET.length));
    await invoke(page, "app.settings.update", { privacy: { mask: { display: false } } });
    await expect(large.locator('[data-line="1"]')).toContainText(LARGE_TEXT_SECRET);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
