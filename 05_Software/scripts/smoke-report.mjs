// REQ-TEST-b111844b
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function smokeStatus(egressStatus, installationStatus = "not-applicable") {
  if (egressStatus === "FAIL" || installationStatus === "FAIL") return "FAIL";
  return egressStatus === "PASS" && installationStatus !== "pending" ? "PASS" : "pending";
}
export function startupFailureFacts(text) {
  const pid = text.match(/<launched> pid=(\d+)/)?.[1];
  const exited = text.match(/<process did exit: exitCode=(null|-?\d+), signal=([^>]+)>/);
  return {
    pid: pid ? Number(pid) : null,
    pidStatus: pid ? "recorded" : "not recorded",
    exit: {
      code: exited && exited[1] !== "null" ? Number(exited[1]) : null,
      signal: exited && exited[2] !== "null" ? exited[2] : null,
      observation: exited
        ? "Original Playwright process exit log"
        : "not recorded; launch rejected before child handle was exposed",
    },
    exitConfirmed: !!exited,
  };
}
export async function fileIdentity(path) {
  const bytes = await readFile(path);
  return { path: resolve(path), bytes: bytes.length, sha256: sha256(bytes) };
}
export function upgradeSummary(proof) {
  assert.equal(proof.schema, 1);
  assert(["PASS", "FAIL"].includes(proof.result), "Upgrade result absent");
  assert(["win32", "linux"].includes(proof.platform));
  assert(proof.artifacts?.length >= 2, "Upgrade artifacts absent");
  for (const a of proof.artifacts) {
    assert(/^[a-f0-9]{64}$/.test(a.sha256) && a.path && a.version && a.bytes > 0, "Unbound upgrade artifact");
  }
  return {
    status: proof.result,
    platform: proof.platform,
    base: proof.base,
    feed: proof.feed,
    artifacts: proof.artifacts,
    checks: proof.checks,
    launches: proof.launches,
    purpose: proof.purpose,
    classification: "supplementary-instrumented-upgrade",
    releaseUpgradeStatus: "pending",
    limitations:
      "Original WP31/32 instrumented connected-host proof; no release, signing, clean/offline or separate-kernel upgrade claim.",
  };
}
export function windowsEvidence(proof, artifactSHA256) {
  if (!proof)
    return {
      status: "pending",
      reason:
        "Windows Sandbox networking Disabled and real pktmon capture await manual execution under standing user deferral.",
    };
  assert.equal(proof.artifactSHA256, artifactSHA256, "Manual evidence artifact mismatch");
  assert(["PASS", "FAIL"].includes(proof.status));
  assert.equal(proof.networking, "Disabled");
  assert(
    proof.observedAt &&
      proof.operator &&
      proof.observations &&
      proof.capture?.path &&
      /^[a-f0-9]{64}$/.test(proof.capture.sha256),
    "Incomplete manual evidence",
  );
  return proof;
}
export function parseSmokeArgs(args) {
  const options = { upgradeProof: [] };
  const names = {
    "--artifact": "artifact",
    "--scratch": "scratch",
    "--resume": "resume",
    "--windows-evidence": "windowsEvidence",
  };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    assert(value && !value.startsWith("--"), `Missing value for ${key}`);
    if (key === "--upgrade-proof") options.upgradeProof.push(resolve(value));
    else {
      assert(names[key] && !options[names[key]], `Unknown/duplicate option ${key}`);
      options[names[key]] = resolve(value);
    }
  }
  assert(
    options.artifact,
    "Usage: smoke:package -- --artifact <path> [--scratch <new owned root>] [--upgrade-proof <original report>] [--windows-evidence <manual JSON>]",
  );
  assert(!(options.scratch && options.resume), "Choose new scratch or owned failed run resume");
  return options;
}
