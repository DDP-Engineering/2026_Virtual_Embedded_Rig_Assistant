// REQ-TEST-803bb75d REQ-TEST-b111844b
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
// @ts-expect-error Native ESM tooling helper.
import { exactLoopback } from "./smoke/smoke-egress.mjs";
// @ts-expect-error Native ESM tooling helper.
import { windowsEvidence } from "./smoke/smoke-report.mjs";
// @ts-expect-error Native ESM tooling helper.
import * as windows from "./smoke/smoke-windows.mjs";

const {
  captureCommands,
  checkWindowsEgress,
  parseKernelEvents,
  pktmonUnavailable,
  processTree,
  stopCapture,
  windowsEvidenceRecord,
} = windows;

// Recorded with pktmon + tracerpt (see the fixture's comment): node PID 40512 served and requested
// 127.0.0.1:62897; its child PID 44384 connected to example.com 104.20.23.154:443.
const sample = await readFile(new URL("../fixtures/pktmon/kernel-events.xml", import.meta.url), "utf8");
const root = 40512;
const sentinel = { pid: 40512, port: 62897 };

it("reads process starts and socket events from the recorded tracerpt XML", () => {
  const { processes, network } = parseKernelEvents(sample);
  expect(processes).toContainEqual(expect.objectContaining({ pid: 44384, parent: 40512 }));
  expect(network).toContainEqual(
    expect.objectContaining({ pid: 44384, daddr: "104.20.23.154", dport: 443, family: "AF_INET" }),
  );
  expect(network).toContainEqual(
    expect.objectContaining({ pid: 40512, saddr: "127.0.0.1", daddr: "127.0.0.1", dport: 62897 }),
  );
  // Other processes' traffic is in the capture too.
  expect(network.some((event: { pid: number }) => event.pid === 4)).toBe(true);
  expect([...processTree(processes, root)].sort()).toEqual([40512, 44384]);
});

it("names a child process's connection to an outside address and ignores other processes", () => {
  const result = checkWindowsEgress(sample, root, exactLoopback(62897), sentinel);
  expect(result.status).toBe("FAIL");
  expect(result.errors).toContain("Forbidden destination: AF_INET 104.20.23.154:443 pid=44384");
  expect(result.errors.every((error: string) => error.includes("pid=44384"))).toBe(true);
  // The root's own requests to the allowed loopback port pass.
  expect(result.destinations).toContainEqual(
    expect.objectContaining({ pid: 40512, address: "127.0.0.1", port: 62897, allowed: true }),
  );
  expect(result.errors.join("\n")).not.toMatch(/pid=(4|3224|9884|32908|44932)\b/);
});

it("passes the tree whose only traffic is the allowed loopback endpoint, and rejects it offline", () => {
  // Without the child, the root's loopback requests are its only traffic.
  const rootOnly = sample.replace(/<Event [^>]*>(?:(?!<\/Event>)[\s\S])*?\b44384\b[\s\S]*?<\/Event>/g, "");
  expect(checkWindowsEgress(rootOnly, root, exactLoopback(62897), sentinel)).toMatchObject({
    status: "PASS",
    errors: [],
  });
  const offline = checkWindowsEgress(rootOnly, root, [], sentinel);
  expect(offline.status).toBe("FAIL");
  // Only the root's request out to 62897 counts; its accepted side of the same connection is inbound.
  expect(offline.errors).toEqual(["Forbidden destination: AF_INET 127.0.0.1:62897 pid=40512"]);
});

it("ignores connections the tree accepted, like Playwright's inspector client, on any port", () => {
  // The recorded accept (15), receive and send of the root's server side, moved to an inspector-like port.
  const serverSide = (event: string) =>
    /<EventID>(?:15|10|11|18|13)<\/EventID>/.test(event) &&
    /<Data Name="PID">\s*40512<\/Data>/.test(event) &&
    /<Data Name="sport">\s*62897<\/Data>/.test(event);
  const accepted = [...sample.matchAll(/<Event [^>]*>[\s\S]*?<\/Event>/g)]
    .map(([event]) => event)
    .filter(serverSide)
    .map((event) => event.replace(/(<Data Name="sport">\s*)62897</, "$19229<"));
  expect(accepted.length).toBeGreaterThan(1);
  const start = sample.match(
    /<Event [^>]*>(?:(?!<\/Event>)[\s\S])*?<EventID>1<\/EventID>[\s\S]*?\b40512\b[\s\S]*?<\/Event>/,
  )?.[0];
  const xml = `<Events>\n${start}\n${accepted.join("\n")}\n</Events>`;
  expect(checkWindowsEgress(xml, root, [], { pid: 40512, port: 9229 })).toMatchObject({
    status: "PASS",
    calls: 0,
    errors: [],
  });
  // The same connection accepted from another host is judged: VERA must not serve the network.
  const lan = xml.replace(/(<Data Name="daddr">\s*)127\.0\.0\.1</g, "$1192.0.2.50<");
  expect(checkWindowsEgress(lan, root, [], { pid: 40512, port: 9229 }).errors).toEqual([
    "Forbidden destination: AF_INET 192.0.2.50:62898 pid=40512",
  ]);
});

it("fails as missing monitor evidence without the launch's start event, the sentinel or any event", () => {
  expect(checkWindowsEgress(sample, 12345, [], sentinel).errors).toContain(
    "No Kernel-Process start event of the launched PID 12345; monitor evidence absent",
  );
  expect(checkWindowsEgress(sample, root, exactLoopback(62897), { pid: 1, port: 9 }).errors).toContain(
    "No Kernel-Network event of the sentinel connection (pid 1, port 9); monitor evidence absent",
  );
  expect(checkWindowsEgress("<Events></Events>", root, [], sentinel).status).toBe("FAIL");
  expect(checkWindowsEgress("not xml", root, [], sentinel).status).toBe("FAIL");
});

it("checks pktmon access and builds the capture commands", () => {
  const run =
    (status: number, stdout = "") =>
    () => ({ status, stdout, stderr: "" });
  expect(
    pktmonUnavailable(run(5, "Failed to communicate with the PktMon driver: Access is denied."), "win32"),
  ).toMatch(/elevated/);
  expect(pktmonUnavailable(run(0, "Packet Monitor is not running."), "win32")).toBeUndefined();
  expect(
    pktmonUnavailable(() => ({ status: null, error: new Error("spawn pktmon ENOENT") }), "win32"),
  ).toMatch(/not found/);
  expect(pktmonUnavailable(run(0), "linux")).toMatch(/Windows/);
  const commands = captureCommands({ etl: "C:\\r\\a.etl", text: "C:\\r\\a.txt", xml: "C:\\r\\a.xml" });
  expect(commands.start.at(-1)).toEqual([
    "pktmon",
    [
      "start",
      "--trace",
      "--provider",
      "Microsoft-Windows-Kernel-Network",
      "--provider",
      "Microsoft-Windows-Kernel-Process",
      "--keywords",
      "0x10",
      "--file-name",
      "C:\\r\\a.etl",
    ],
  ]);
  // Events only: no packet capture and no change to the host's packet filters.
  expect(commands.start).toHaveLength(1);
  expect(commands.stop.map(([command]: [string]) => command)).toEqual(["pktmon", "pktmon", "tracerpt"]);
  // A failed conversion names its command; the harness reports it as missing monitor evidence.
  const failing = (command: string) => (name: string) => ({
    status: name === command ? 1 : 0,
    stdout: "",
    stderr: "conversion error",
  });
  expect(() => stopCapture({ etl: "a.etl", text: "a.txt", xml: "a.xml" }, failing("tracerpt"))).toThrow(
    /^tracerpt a\.etl -of XML -o a\.xml -y failed \(1\): conversion error$/,
  );
});

it("writes evidence that the report accepts unchanged, and keeps a missing proof pending with its reason", () => {
  const artifact = "a".repeat(64);
  const evidence = windowsEvidenceRecord({
    artifactSHA256: artifact,
    status: "PASS",
    operator: "tester",
    observations: [{ label: "offline", egress: "PASS" }],
    capture: { path: "C:\\r\\windows-capture.json", sha256: "b".repeat(64) },
  });
  expect(evidence).toMatchObject({ method: "pktmon", networking: "Enabled", status: "PASS" });
  expect(windowsEvidence(evidence, artifact)).toEqual(evidence);
  expect(() => windowsEvidence({ ...evidence, method: undefined }, artifact)).toThrow();
  expect(() => windowsEvidence(evidence, "c".repeat(64))).toThrow();
  const pending = windowsEvidence(null, artifact, "pktmon needs an elevated shell");
  expect(pending).toEqual({ status: "pending", reason: "pktmon needs an elevated shell" });
});
