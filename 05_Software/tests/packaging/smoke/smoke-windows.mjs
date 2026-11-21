// REQ-TEST-803bb75d: Windows egress of the launched process tree from a pktmon capture.
// pktmon logs the Microsoft-Windows-Kernel-Network socket events (PID, saddr, sport, daddr, dport) and the
// Kernel-Process start events (ProcessID, ParentProcessID) next to the packets; tracerpt writes them as XML
// whose field names do not depend on the Windows display language. The etl2txt text is kept for people.
import { spawnSync } from "node:child_process";
import { connect, createServer } from "node:net";

const network = "Microsoft-Windows-Kernel-Network";
const kernelProcess = "Microsoft-Windows-Kernel-Process";

/** Why pktmon cannot capture here, or undefined. Exit 5 is ERROR_ACCESS_DENIED: the shell is not elevated. */
export function pktmonUnavailable(run = spawnSync, platform = process.platform) {
  if (platform !== "win32") return "the pktmon capture exists only on Windows";
  const result = run("pktmon", ["status"], { encoding: "utf8" });
  if (result.error) return `pktmon not found (${result.error.message})`;
  if (result.status === 5 || /access is denied/i.test(`${result.stdout}${result.stderr}`))
    return "pktmon needs an elevated shell: run the smoke from an administrator PowerShell, or supply --windows-evidence";
  return undefined;
}

/** The commands that start a capture into `paths.etl` and stop and convert it into `paths.text` and `paths.xml`. */
export function captureCommands(paths) {
  return {
    // Events only: the oracle never reads packets, and full packets of every host application would make the
    // dump grow by megabytes per second. Packet filters only affect packet capture, so they stay as they are.
    start: [
      [
        "pktmon",
        [
          "start",
          "--trace",
          "--provider",
          network,
          "--provider",
          kernelProcess,
          "--keywords",
          "0x10", // WINEVENT_KEYWORD_PROCESS: process start and stop only
          "--file-name",
          paths.etl,
        ],
      ],
    ],
    stop: [
      ["pktmon", ["stop"]],
      ["pktmon", ["etl2txt", paths.etl, "--out", paths.text]],
      ["tracerpt", [paths.etl, "-of", "XML", "-o", paths.xml, "-y"]],
    ],
  };
}

function runAll(commands, run) {
  for (const [command, args] of commands) {
    const result = run(command, args, { encoding: "utf8" });
    if (result.status !== 0)
      throw new Error(
        `${command} ${args.join(" ")} failed (${result.status}): ${String(
          result.error?.message ?? `${result.stdout}${result.stderr}`,
        )
          .trim()
          .slice(-1000)}`,
      );
  }
}
export const startCapture = (paths, run = spawnSync) => runAll(captureCommands(paths).start, run);
export const stopCapture = (paths, run = spawnSync) => runAll(captureCommands(paths).stop, run);

/**
 * One loopback connection from this process to a listener of its own, made while the capture runs: its
 * Kernel-Network event proves the capture logged socket events even when VERA made none.
 */
export async function sentinelConnection() {
  const server = createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.end());
    socket.on("close", resolve);
    socket.on("error", reject);
  });
  await new Promise((resolve) => server.close(resolve));
  return { pid: process.pid, port };
}

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => entities[name]);
/** tracerpt pads numbers with spaces; some fields are hexadecimal. */
const number = (text) => {
  const value = text?.trim();
  if (!value) return Number.NaN;
  return /^0x[0-9a-f]+$/i.test(value)
    ? Number.parseInt(value, 16)
    : /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
};

/** The Kernel-Process starts and Kernel-Network socket events of a tracerpt XML dump. */
export function parseKernelEvents(xml) {
  const processes = [];
  const sockets = [];
  let events = 0;
  for (const [block] of xml.matchAll(/<Event\b[^>]*>[\s\S]*?<\/Event>/g)) {
    events++;
    const provider = block.match(/<Provider Name="([^"]*)"/)?.[1];
    const id = Number(block.match(/<EventID>(\d+)<\/EventID>/)?.[1]);
    const data = Object.fromEntries(
      [...block.matchAll(/<Data Name="([^"]+)">([^<]*)<\/Data>/g)].map(([, name, value]) => [
        name,
        decode(value),
      ]),
    );
    const time = block.match(/<TimeCreated SystemTime="([^"]+)"/)?.[1];
    if (provider === kernelProcess && id === 1)
      processes.push({
        pid: number(data.ProcessID),
        parent: number(data.ParentProcessID),
        image: data.ImageName?.trim() ?? "",
        time,
      });
    else if (provider === network) {
      const saddr = data.saddr?.trim() ?? "";
      const daddr = data.daddr?.trim() ?? "";
      sockets.push({
        id,
        pid: number(data.PID),
        saddr,
        sport: number(data.sport),
        daddr,
        dport: number(data.dport),
        family: daddr.includes(":") || saddr.includes(":") ? "AF_INET6" : "AF_INET",
        time,
      });
    }
  }
  return { events, processes, network: sockets };
}

/** The launched PID and every process started under it during the capture. */
export function processTree(processes, root) {
  const tree = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const process of processes)
      if (tree.has(process.parent) && !tree.has(process.pid)) {
        tree.add(process.pid);
        grew = true;
      }
  }
  return tree;
}

const loopback = (address) => /^127\./.test(address) || address === "::1";
const udpReceive = new Set([43, 59]);
const tcpAccept = new Set([15, 31]);
const connection = (event) => `${event.pid}|${event.saddr}:${event.sport}|${event.daddr}:${event.dport}`;
const validPort = (port) => Number.isInteger(port) && port >= 0 && port <= 65535;

/**
 * The egress oracle of one launch, with the shape of the Linux strace check: every destination the launched
 * process tree sends to must be an allowed exact loopback address and port (none offline). Connections the tree
 * accepted, such as Playwright's inspector and DevTools clients, and received UDP datagrams are inbound; strace
 * does not see them either.
 */
export function checkWindowsEgress(xml, root, allowed = [], sentinel) {
  const errors = [];
  const destinations = [];
  let parsed;
  try {
    parsed = parseKernelEvents(xml);
  } catch (error) {
    parsed = { events: 0, processes: [], network: [] };
    errors.push(`Unreadable capture: ${error.message}`);
  }
  if (!parsed.events) errors.push("No events in the capture; monitor evidence absent");
  if (!parsed.processes.some((process) => process.pid === root))
    errors.push(`No Kernel-Process start event of the launched PID ${root}; monitor evidence absent`);
  if (
    sentinel &&
    !parsed.network.some(
      (event) =>
        event.pid === sentinel.pid && (event.dport === sentinel.port || event.sport === sentinel.port),
    )
  )
    errors.push(
      `No Kernel-Network event of the sentinel connection (pid ${sentinel.pid}, port ${sentinel.port}); monitor evidence absent`,
    );
  const tree = processTree(parsed.processes, root);
  const permitted = (address, port) =>
    allowed.some((entry) => entry.address === address && entry.port === port);
  const own = parsed.network.filter((event) => tree.has(event.pid));
  // TCP events name the remote end daddr in both directions (recorded sample), so one connection keeps one key.
  // Only loopback clients count as inbound; a connection accepted from another host is judged like one out.
  const inbound = new Set(
    own
      .filter((event) => tcpAccept.has(event.id) && loopback(event.saddr) && loopback(event.daddr))
      .map(connection),
  );
  const outbound = own.filter((event) => !udpReceive.has(event.id) && !inbound.has(connection(event)));
  for (const event of outbound) {
    if (!event.daddr || !validPort(event.dport) || !event.saddr || !validPort(event.sport)) {
      errors.push(`Unparsed network event ${event.id}: pid=${event.pid}`);
      continue;
    }
    const ok = loopback(event.daddr) && permitted(event.daddr, event.dport);
    destinations.push({
      pid: event.pid,
      family: event.family,
      address: event.daddr,
      port: event.dport,
      event: event.id,
      allowed: ok,
    });
    if (!ok) {
      const text = `Forbidden destination: ${event.family} ${event.daddr}:${event.dport} pid=${event.pid}`;
      if (!errors.includes(text)) errors.push(text);
    }
  }
  return {
    status: errors.length ? "FAIL" : "PASS",
    calls: outbound.length,
    tree: [...tree],
    destinations,
    errors,
    allowed,
  };
}

/** The evidence JSON of an automated capture, in the shape `windowsEvidence` checks. */
export function windowsEvidenceRecord({ artifactSHA256, status, operator, observations, capture }) {
  return {
    schema: 1,
    method: "pktmon",
    networking: "Enabled",
    artifactSHA256,
    status,
    operator,
    observedAt: new Date().toISOString(),
    observations,
    capture,
  };
}
