// REQ-TEST-8928f10f REQ-TEST-f84d343e REQ-TEST-b111844b
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
// @ts-expect-error Native ESM tooling helper.
import { nsisPayload, veraInstallNamePattern } from "../../scripts/smoke-runtime.mjs";

it("accepts flattened and wrapped NSIS payloads while rejecting absent payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-nsis-layout-"));
  try {
    await expect(nsisPayload(root)).rejects.toThrow("NSIS x64 payload absent");
    await writeFile(join(root, "vera.exe"), "fixture");
    await mkdir(join(root, "resources"));
    await writeFile(join(root, "resources/app.asar"), "fixture");
    expect(await nsisPayload(root)).toEqual({ directory: root });
    await writeFile(join(root, "app-64.7z"), "fixture");
    expect(await nsisPayload(root)).toEqual({ archive: join(root, "app-64.7z") });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("protects versioned and companion VERA installer identities", () => {
  const pattern = new RegExp(veraInstallNamePattern, "i");
  for (const name of ["VERA", "VERA 0.0.0", "VERA WP31 Test 0.31.1", "vera 1.0"])
    expect(pattern.test(name)).toBe(true);
  for (const name of ["Other", "VERACITY", "My VERA"]) expect(pattern.test(name)).toBe(false);
});

// @ts-expect-error Native ESM tooling helper.
import { checkEgress, exactLoopback } from "../../scripts/smoke-egress.mjs";
// @ts-expect-error Native ESM tooling helper.
import * as smokeReport from "../../scripts/smoke-report.mjs";

const { parseSmokeArgs, smokeStatus, startupFailureFacts, upgradeSummary, windowsEvidence } = smokeReport;

// @ts-expect-error Native ESM tooling helper.
import { assertRequestBudget, assertSnapshotBudget, startSmokeServer } from "../../scripts/smoke-server.mjs";

const unix = '1 connect(4, {sa_family=AF_UNIX, sun_path="/run/dbus"}, 20) = -1 ENOENT';
const inet = (port = 1234, ip = "127.0.0.1", pid = 2) =>
  `${pid} connect(9, {sa_family=AF_INET, sin_port=htons(${port}), sin_addr=inet_addr("${ip}")}, 16) = -1 EINPROGRESS`;

it("checks whole-tree IPv4/IPv6 and failed attempts, permitting only the exact tuple", () => {
  expect(checkEgress(unix).status).toBe("PASS");
  expect(checkEgress(`${unix}\n${inet()}`).status).toBe("FAIL");
  expect(checkEgress(inet(), exactLoopback(1234)).status).toBe("PASS");
  expect(checkEgress(inet(1235), exactLoopback(1234)).status).toBe("FAIL");
  expect(checkEgress(inet(1234, "127.0.0.2"), exactLoopback(1234)).status).toBe("FAIL");
  const v6 =
    '33 sendmsg(8, {msg_name={sa_family=AF_INET6, sin6_port=htons(1234), inet_pton(AF_INET6, "::1", &sin6_addr)}, msg_iov=[]}, 0) = 1';
  expect(checkEgress(v6, exactLoopback(1234)).status).toBe("FAIL");
  expect(checkEgress(v6, [{ family: "AF_INET6", address: "::1", port: 1234 }]).status).toBe("PASS");
});

it("reassembles interleaved unfinished/resumed calls and fails closed on missing or truncated evidence", () => {
  const split = inet().replace(" = -1 EINPROGRESS", " <unfinished ...>");
  const trace = `${split}\n${unix}\n2 <... connect resumed>) = -1 EINPROGRESS`;
  expect(checkEgress(trace).destinations).toHaveLength(1);
  expect(checkEgress(trace).status).toBe("FAIL");
  for (const input of [
    "",
    split,
    "2 <... connect resumed>) = 0",
    "2 connect(4, {sa_family=AF_INET, sin_port=htons(2), ...}, 16) = 0",
    inet().replace(" = -1 EINPROGRESS", ""),
  ])
    expect(checkEgress(input, exactLoopback(1234)).status).toBe("FAIL");
});

it("accepts real strace spacing for resumed connected Unix sends without masking a destination", () => {
  const connected =
    '750 sendto(4, "fixture", 7, MSG_NOSIGNAL, NULL, 0 <unfinished ...>\n750 <... sendto resumed>) = 7';
  expect(checkEgress(`${unix}\n${connected}`).status).toBe("PASS");
  expect(checkEgress(`${unix}\n${connected}\n${inet(1235)}`, exactLoopback(1234)).status).toBe("FAIL");
});

it("reads sockaddr outside quoted sendto payload text so payload cannot mask a forbidden port", () => {
  const spoof =
    '9 sendto(9, "sin_port=htons(1234)", 20, 0, {sa_family=AF_INET, sin_port=htons(1235), sin_addr=inet_addr("127.0.0.1")}, 16) = 20';
  expect(checkEgress(spoof, exactLoopback(1234)).status).toBe("FAIL");
  expect(checkEgress(spoof, exactLoopback(1234)).destinations[0].port).toBe(1235);
  const fakeFamily = '9 sendto(9, "sa_family=AF_INET sin_port=htons(1235)", 40, 0, NULL, 0) = 40';
  expect(checkEgress(`${unix}\n${fakeFamily}`).status).toBe("PASS");
});

it("provides the already-built artifact smoke entrypoint without an implicit build", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  expect(pkg.scripts["smoke:package"]).toBe("node scripts/smoke-package.mjs");
});

it("keeps missing Windows evidence pending and rejects mismatched or incomplete proof", () => {
  expect(windowsEvidence(null, "a".repeat(64)).status).toBe("pending");
  expect(() => windowsEvidence({ status: "PASS", artifactSHA256: "b".repeat(64) }, "a".repeat(64))).toThrow();
  expect(() =>
    windowsEvidence(
      { status: "PASS", artifactSHA256: "a".repeat(64), networking: "Disabled" },
      "a".repeat(64),
    ),
  ).toThrow();
  const artifacts = ["0.31.0", "0.31.1"].map((version) => ({
    version,
    path: "VERA-test.exe",
    bytes: 1,
    sha256: "a".repeat(64),
  }));
  const proof = { schema: 1, result: "PASS", platform: "win32", artifacts };
  expect(upgradeSummary(proof)).toMatchObject({
    status: "PASS",
    classification: "supplementary-instrumented-upgrade",
    releaseUpgradeStatus: "pending",
    artifacts,
  });
  expect(() => upgradeSummary({ ...proof, result: undefined })).toThrow();
  expect(() => upgradeSummary({ ...proof, artifacts: [{}] })).toThrow();
  expect(() => parseSmokeArgs([])).toThrow();
  expect(() => parseSmokeArgs(["--artifact", "a", "--build", "yes"])).toThrow();
  expect(
    parseSmokeArgs(["--artifact", "a", "--upgrade-proof", "one", "--upgrade-proof", "two"]).upgradeProof,
  ).toHaveLength(2);
});

it("preserves explicit failed egress and pending NSIS installation in the overall result", () => {
  expect(smokeStatus("FAIL", "PASS")).toBe("FAIL");
  expect(smokeStatus("PASS", "pending")).toBe("pending");
  expect(smokeStatus("pending", "PASS")).toBe("pending");
  expect(smokeStatus("PASS", "PASS")).toBe("PASS");
});

it("records observed startup rejection facts and preserves unknown PID/exit honestly", () => {
  expect(
    startupFailureFacts("<launched> pid=33\n[pid=33] <process did exit: exitCode=1, signal=null>"),
  ).toMatchObject({ pid: 33, exit: { code: 1 }, exitConfirmed: true });
  expect(startupFailureFacts("Executable missing")).toMatchObject({
    pid: null,
    pidStatus: "not recorded",
    exit: { code: null },
    exitConfirmed: false,
  });
});

it("bounds full serialized requests and verifies observed complete context/output reserves", () => {
  expect(assertRequestBudget({ max_completion_tokens: 4096 }, 100).inputBudgetTokens).toBe(27033);
  expect(() => assertRequestBudget({ max_completion_tokens: 8192 }, 100)).toThrow();
  expect(() => assertRequestBudget({ max_completion_tokens: 4096 }, 27034)).toThrow();
  const usage = {
    contextTokens: 9234,
    contextWindow: 32768,
    inputBudgetTokens: 27033,
    reservedOutputTokens: 4096,
    safetyMarginTokens: 1639,
  };
  expect(assertSnapshotBudget(usage)).toEqual(usage);
  expect(() => assertSnapshotBudget({ ...usage, contextTokens: 30000 })).toThrow();
  expect(() => assertSnapshotBudget({ ...usage, reservedOutputTokens: undefined })).toThrow();
});

it("rejects ordinary endpoint requests with invalid output or oversized full context", async () => {
  const server = await startSmokeServer();
  try {
    for (const [max_completion_tokens, content] of [
      [8192, "smoke"],
      [4096, "x".repeat(30000)],
    ]) {
      const res = await fetch(`${server.url}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({
          model: "smoke",
          stream: true,
          max_completion_tokens,
          tools: ["read", "write"].map((name) => ({ function: { name } })),
          messages: [{ role: "system", content }],
        }),
      });
      expect(res.status).toBe(400);
      await res.text();
    }
    expect(server.requests).toHaveLength(0);
  } finally {
    await server.close();
  }
});

it("streams split tool arguments and a citation through an ordinary OpenAI-compatible endpoint", async () => {
  const server = await startSmokeServer();
  const tools = ["read", "write"].map((name) => ({ function: { name } }));
  const messages: { role: string; content: string }[] = [{ role: "system", content: "smoke" }];
  try {
    expect(new URL(server.url).hostname).toBe("127.0.0.1");
    const request = async () => {
      const res = await fetch(`${server.url}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model: "smoke", stream: true, max_completion_tokens: 4096, tools, messages }),
      });
      expect(res.status).toBe(200);
      return res.text();
    };
    expect(await request()).toContain('"name":"read"');
    messages.push({ role: "tool", content: '{"ref":"board.txt#L1-L2"}' });
    expect(await request()).toContain('"name":"write"');
    messages.push({ role: "tool", content: '{"applied":true}' });
    expect(await request()).toContain("[[board.txt#L1-L2]]");
    expect(server.requests).toHaveLength(3);
    expect(server.errors).toEqual([]);
    expect((await fetch(`${server.url}/wrong`)).status).toBe(404);
  } finally {
    await server.close();
  }
});
