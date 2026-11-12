// REQ-TEST-f84d343e: external strace destinations, including failed attempts.
import assert from "node:assert/strict";

function outsideStrings(line) {
  let quoted = false,
    escaped = false,
    masked = "";
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
        masked += " ";
      } else if (char === "\\") {
        escaped = true;
        masked += " ";
      } else if (char === '"') {
        quoted = false;
        masked += char;
      } else masked += " ";
    } else {
      masked += char;
      if (char === '"') quoted = true;
    }
  }
  return { masked, complete: !quoted };
}
function sockaddrs(line, masked) {
  const results = [];
  for (const family of masked.matchAll(/(?:sa_family|sin6?_family)=([A-Z0-9_]+)/g)) {
    const stack = [];
    for (let i = 0; i < family.index; i++) {
      if (masked[i] === "{") stack.push(i);
      if (masked[i] === "}") stack.pop();
    }
    const start = stack.at(-1);
    if (start === undefined) {
      results.push({ family: family[1], invalid: true });
      continue;
    }
    let depth = 1,
      end = start + 1;
    for (; end < masked.length && depth; end++) {
      if (masked[end] === "{") depth++;
      if (masked[end] === "}") depth--;
    }
    const shape = masked.slice(start, end),
      raw = line.slice(start, end);
    const addressAt = shape.match(/sin_addr=inet_addr\(/)?.index;
    const v6At = shape.match(/inet_pton\(AF_INET6, /)?.index;
    const address =
      addressAt !== undefined
        ? raw.slice(addressAt).match(/^sin_addr=inet_addr\("([^"]+)"\)/)?.[1]
        : v6At !== undefined
          ? raw.slice(v6At).match(/^inet_pton\(AF_INET6, "([^"]+)"/)?.[1]
          : null;
    const port = Number(shape.match(/sin6?_port=htons\((\d+)\)/)?.[1]);
    results.push({ family: family[1], address, port, invalid: depth !== 0 || shape.includes("...") });
  }
  return results;
}

export function checkEgress(trace, allowed = []) {
  const pending = new Map();
  const destinations = [];
  const errors = [];
  let calls = 0;
  for (const raw of trace.split("\n")) {
    const match = raw.match(/^(?:\[pid\s+(\d+)\]\s*|(\d+)\s+)?(.*)$/);
    const pid = match[1] ?? match[2] ?? "main";
    let line = match[3];
    if (/^<\.\.\. (connect|sendto|sendmsg) resumed>/.test(line)) {
      const first = pending.get(pid);
      if (!first) {
        errors.push(`Unpaired resumed syscall: ${raw}`);
        continue;
      }
      pending.delete(pid);
      line = first + line.replace(/^<\.\.\. \w+ resumed>/, "");
    }
    if (!/^(connect|sendto|sendmsg)\(/.test(line)) continue;
    if (line.includes("<unfinished ...>")) {
      if (pending.has(pid)) errors.push(`Duplicate unfinished syscall: ${raw}`);
      pending.set(pid, line.replace("<unfinished ...>", ""));
      continue;
    }
    calls++;
    const { masked, complete } = outsideStrings(line);
    if (!complete || !/\)\s+=\s+(?:-?\d+|\?)/.test(masked)) {
      errors.push(`Truncated syscall: ${raw}`);
      continue;
    }
    const families = sockaddrs(line, masked);
    if (!families.length) {
      // Connected sendto/sendmsg have no destination and are covered by connect.
      if (!/^(sendto\(.*?, NULL, 0\s*\)|sendmsg\(.*?msg_name=NULL)/.test(masked))
        errors.push(`Unparsed destination: ${raw}`);
      continue;
    }
    for (const family of families) {
      if (!["AF_INET", "AF_INET6"].includes(family.family)) continue;
      const { address, port } = family;
      if (family.invalid || !address || !Number.isInteger(port) || port < 0 || port > 65535) {
        errors.push(`Incomplete inet destination: ${raw}`);
        continue;
      }
      const destination = { pid, family: family.family, address, port, syscall: line.split("(")[0] };
      destinations.push(destination);
      if (!allowed.some((a) => a.family === destination.family && a.address === address && a.port === port))
        errors.push(`Forbidden destination: ${destination.family} ${address}:${port} pid=${pid}`);
    }
  }
  for (const [pid] of pending) errors.push(`Unfinished syscall at trace end: pid=${pid}`);
  if (!calls) errors.push("No traced network syscalls; monitor evidence absent");
  return { status: errors.length ? "FAIL" : "PASS", calls, destinations, errors, allowed };
}

export function exactLoopback(port) {
  assert(Number.isInteger(port) && port > 0 && port <= 65535, "Invalid endpoint port");
  return [{ family: "AF_INET", address: "127.0.0.1", port }];
}
