// REQ-TEST-803bb75d REQ-TEST-b111844b REQ-SEC-b4170ade
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
  etwProviderGuids,
  etwProviders,
  inferenceTelemetryWatch,
  onnxRuntimeProviders,
  parseKernelEvents,
  pktmonUnavailable,
  processTree,
  sampleInBackground,
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

// Recorded with `logman query providers -pid` on Electron 44 running an ONNX Runtime 1.30 session without the
// Windows switch: both of ORT's providers are registered.
const listing = await readFile(
  new URL("../fixtures/logman/providers-onnxruntime.txt", import.meta.url),
  "utf8",
);
const lines = listing.split("\n");
const withoutTelemetry = lines.filter((line) => !line.includes(onnxRuntimeProviders.telemetry)).join("\r\n");
const unloaded = lines
  .filter(
    (line) => !line.includes(onnxRuntimeProviders.telemetry) && !line.includes(onnxRuntimeProviders.logging),
  )
  .join("\r\n");
const guids = (text: string) => etwProviderGuids(text);
// The app's processes as Electron's getAppMetrics() names them. The smoke's local inference runs in Node
// utility processes (the Indexer); a second one stands for any other Node utility.
const metrics = [
  { pid: 1, type: "Browser", name: undefined, serviceName: undefined },
  { pid: 3, type: "GPU", name: "GPU", serviceName: undefined },
  { pid: 4, type: "Tab", name: undefined, serviceName: undefined },
  { pid: 5, type: "Utility", name: "Network Service", serviceName: "network.mojom.NetworkService" },
  { pid: 2, type: "Utility", name: "VERA Indexer", serviceName: "node.mojom.NodeService" },
  { pid: 6, type: "Utility", name: "Helper", serviceName: "node.mojom.NodeService" },
];

it("reads a process's registered ETW providers from logman, with a timeout", async () => {
  const providers = etwProviderGuids(listing);
  expect(providers.has(onnxRuntimeProviders.telemetry)).toBe(true);
  expect(providers.has(onnxRuntimeProviders.logging)).toBe(true);
  expect(providers.has("{57277741-3638-4A4B-BDBA-0AC6E45DA56C}")).toBe(true);
  const calls: unknown[][] = [];
  const run = async (...call: unknown[]) => {
    calls.push(call);
    if (Array.isArray(call[1]) && call[1].at(-1) === "7") return { stdout: listing };
    // A process logman cannot find: exit 0x80070490, as logman reports it.
    throw Object.assign(new Error("Command failed"), {
      code: 2147943568,
      stdout: "\r\nError:\r\nElement not found.\r\n",
      stderr: "",
    });
  };
  expect((await etwProviders(7, run)).has(onnxRuntimeProviders.logging)).toBe(true);
  await expect(etwProviders(8, run)).rejects.toThrow(
    /^logman query providers -pid 8 failed \(2147943568\): Error:\r\nElement not found\.$/,
  );
  expect(calls[0]).toEqual([
    "logman",
    ["query", "providers", "-pid", "7"],
    { encoding: "utf8", timeout: 30_000 },
  ]);
  expect(calls).toHaveLength(2);
  // 0x80071068: a provider of the process went away while logman read the list; logman is asked again.
  let attempts = 0;
  const racing = (failures: number) => async () => {
    attempts += 1;
    if (attempts > failures) return { stdout: listing };
    throw Object.assign(new Error("Command failed"), {
      code: 2147946600,
      stdout: "\r\nError:\r\nThe GUID passed was not recognized as valid by a WMI data provider.\r\n",
      stderr: "",
    });
  };
  expect((await etwProviders(9, racing(2))).has(onnxRuntimeProviders.logging)).toBe(true);
  expect(attempts).toBe(3);
  attempts = 0;
  await expect(etwProviders(9, racing(3))).rejects.toThrow(
    /^logman query providers -pid 9 failed \(2147946600\)/,
  );
  expect(attempts).toBe(3);
});

it("passes once ORT ran in a Node process that never registered its telemetry provider", async () => {
  const queried: number[] = [];
  let sample = 0;
  const watch = inferenceTelemetryWatch({
    query: async (pid: number) => {
      queried.push(pid);
      // The Indexer loads ORT for its embeddings from the second sample on; the other utility never does.
      return guids(pid === 2 && sample > 1 ? withoutTelemetry : unloaded);
    },
    alive: () => true,
  });
  sample = 1;
  await watch.sample(metrics);
  expect(watch.seenOnnxRuntime()).toBe(false);
  // One listing with ORT loaded is not enough: a provider registered a little later would be missed.
  sample = 2;
  await watch.sample(metrics);
  expect(watch.seenOnnxRuntime()).toBe(false);
  sample = 3;
  await watch.sample(metrics);
  expect(watch.seenOnnxRuntime()).toBe(true);
  // Main (about 30 s per logman query), renderers, the GPU process and the network service are not queried.
  expect(queried).toEqual([2, 6, 2, 6, 2, 6]);
  expect(watch.result()).toEqual({
    status: "PASS",
    processes: [
      {
        pid: 2,
        type: "Utility",
        name: "VERA Indexer",
        samples: 3,
        onnxRuntimeSamples: 2,
        onnxRuntime: true,
        telemetry: false,
      },
      {
        pid: 6,
        type: "Utility",
        name: "Helper",
        samples: 3,
        onnxRuntimeSamples: 0,
        onnxRuntime: false,
        telemetry: false,
      },
    ],
    errors: [],
  });
});

it("fails on a registered telemetry provider, on ORT never seen and on a live process that cannot be queried", async () => {
  // A provider seen once stays a failure, even when later samples no longer list it.
  let round = 0;
  const registered = inferenceTelemetryWatch({
    query: async (pid: number) => guids(pid !== 2 ? unloaded : round === 1 ? listing : withoutTelemetry),
    alive: () => true,
  });
  for (round = 1; round <= 2; round++) await registered.sample(metrics);
  expect(registered.result()).toMatchObject({
    status: "FAIL",
    errors: ["ONNX Runtime telemetry provider registered: pid=2 Utility VERA Indexer"],
  });
  // Without ORT loaded while sampling, the missing provider proves nothing.
  const never = inferenceTelemetryWatch({ query: async () => guids(unloaded), alive: () => true });
  await never.sample(metrics);
  expect(never.result()).toMatchObject({
    status: "FAIL",
    errors: ["ONNX Runtime was not loaded in any Node process while the app ran local inference"],
  });
  // A process that exited before its query is recorded; a live one that does not answer fails the check.
  const failing = async (pid: number) => {
    if (pid === 2) return guids(withoutTelemetry);
    throw new Error(`logman query providers -pid ${pid} failed (2147943568): Element not found.`);
  };
  const exited = inferenceTelemetryWatch({ query: failing, alive: () => false });
  await exited.sample(metrics);
  expect(exited.result()).toMatchObject({
    status: "PASS",
    processes: [{ pid: 2 }, { pid: 6, samples: 0, exited: true }],
  });
  // A live process that did not answer once stays a failure, even when it answers later.
  let answered = false;
  const live = inferenceTelemetryWatch({
    query: async (pid: number) => (answered ? guids(withoutTelemetry) : failing(pid)),
    alive: () => true,
  });
  await live.sample(metrics);
  answered = true;
  await live.sample(metrics);
  expect(live.result()).toMatchObject({
    status: "FAIL",
    errors: ["logman query providers -pid 6 failed (2147943568): Element not found."],
  });
});

it("samples in the background until stopped, and reports the error that ended the sampling", async () => {
  let count = 0;
  const sampling = sampleInBackground(async () => {
    count += 1;
  }, 1);
  while (count < 3) await new Promise((resolve) => setTimeout(resolve, 1));
  await sampling.stop();
  const stoppedAt = count;
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(count).toBe(stoppedAt);
  expect(sampling.failed()).toBe(false);
  const failing = sampleInBackground(async () => {
    throw new Error("Target page, context or browser has been closed");
  }, 1);
  // The smoke's wait for ORT ends as soon as the sampling has failed.
  while (!failing.failed()) await new Promise((resolve) => setTimeout(resolve, 1));
  await expect(failing.stop()).rejects.toThrow("has been closed");
});
