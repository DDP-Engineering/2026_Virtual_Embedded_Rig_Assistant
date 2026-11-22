import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Node ESM evaluator modules; their behavior is what these tests check.
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const safety = await load("evaluators/safety/run.mjs");
const { loadCases } = await load("evaluators/shared/cases.mjs");
const { startModelProxy } = await load("evaluators/shared/model-proxy.mjs");
const { startEgressGuard } = await load("evaluators/shared/egress-guard.mjs");

describe("canary detection", () => {
  it("counts raw, JSON-escaped, base64 and hex forms separately", () => {
    const canary = 'vera-canary-abc-"q\\';
    const forms = safety.canaryForms(canary);
    expect(forms.escaped).toBe('vera-canary-abc-\\"q\\\\');
    const body = JSON.stringify({ messages: [{ content: `pw=${canary}` }] });
    expect(safety.canaryHits([body], forms)).toEqual({ raw: 0, escaped: 1, base64: 0, hex: 0 });
    expect(safety.canaryHits([`${canary} ${forms.base64} ${forms.hex}`], forms)).toEqual({
      raw: 1,
      escaped: 0,
      base64: 1,
      hex: 1,
    });
    expect(safety.canaryHits(["pw=[REDACTED]"], forms)).toEqual({ raw: 0, escaped: 0, base64: 0, hex: 0 });
  });

  it("makes canaries whose escaped form differs from the raw one", () => {
    const canary = safety.newCanary();
    expect(canary).toMatch(/^vera-canary-[0-9a-f]{12}-"q\\$/);
    expect(safety.canaryForms(canary).escaped).not.toBe(canary);
  });
});

describe("safety cases", () => {
  it("are valid and cover each injection channel, web leakage and secrets", async () => {
    const file = await loadCases(safety.spec.casesFile, safety.spec.expect);
    const kinds = file.cases.map((c: { expect: { kind: string } }) => c.expect.kind);
    expect(kinds.filter((k: string) => k === "injection").length).toBeGreaterThanOrEqual(4);
    expect(kinds).toContain("web-leak");
    expect(kinds).toContain("secret");
    const setups = file.cases.flatMap((c: { setup?: { path: string }[] }) => c.setup ?? []);
    expect(setups.some((s: { pdf?: string }) => s.pdf)).toBe(true);
  });
});

describe("network boundaries of a run", () => {
  it("the egress guard refuses an outside request and records its host", async () => {
    const { spawn } = await import("node:child_process");
    const guard = await startEgressGuard();
    const output = await new Promise<string>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          "fetch('https://example.invalid/x').then(()=>console.log('fetched'),()=>console.log('blocked'))",
        ],
        { env: { ...process.env, ...guard.env } },
      );
      let text = "";
      child.stdout.on("data", (d) => {
        text += d;
      });
      child.on("close", () => resolve(text.trim()));
    });
    expect(output).toBe("blocked");
    expect(guard.take()).toEqual(["example.invalid:443"]);
    await guard.close();
  });

  it("the model proxy listens on loopback, forwards to its target and sets the reasoning level", async () => {
    const { createServer } = await import("node:http");
    const seen: { url: string | undefined; body: string }[] = [];
    const upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => {
        body += d;
      });
      req.on("end", () => {
        seen.push({ url: req.url, body });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    const address = upstream.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const proxy = await startModelProxy({
      target: `http://127.0.0.1:${port}/v1`,
      reasoning: "off",
      record: true,
    });
    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    await fetch(`${proxy.url}/chat/completions`, { method: "POST", body: JSON.stringify({ model: "m" }) });
    expect(seen[0]?.url).toBe("/v1/chat/completions");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ model: "m", reasoning_effort: "none" });
    expect(proxy.requests).toHaveLength(1);
    await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
  });
});
