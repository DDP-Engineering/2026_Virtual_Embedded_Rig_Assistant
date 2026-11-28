import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createSocket } from "node:dgram";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import {
  type CaptureReference,
  captureLimits,
  captureReferenceSchema,
  classifyCommand,
  deriveCaptureToolSchema,
  type PluginManifest,
  validatePluginManifest,
} from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { reportSkip } from "../support/skip-marker.js";

const plugins = new URL("../../plugins/", import.meta.url);
const source = new URL("wireshark-tshark/", plugins);
const sample = fileURLToPath(new URL("../fixtures/wireshark-tshark/sample.pcapng", import.meta.url));
const trafficSample = fileURLToPath(new URL("../fixtures/wireshark-tshark/traffic.pcapng", import.meta.url));
const untimedSample = fileURLToPath(new URL("../fixtures/wireshark-tshark/untimed.pcapng", import.meta.url));
const automotiveSample = new URL("../fixtures/wireshark-tshark/automotive.pcapng", import.meta.url);
const automotiveCoverageSample = new URL(
  "../fixtures/wireshark-tshark/automotive-coverage.pcapng",
  import.meta.url,
);
const automotiveMixedVlanSample = new URL(
  "../fixtures/wireshark-tshark/automotive-mixed-vlan.pcapng",
  import.meta.url,
);
const networkingSample = fileURLToPath(
  new URL("../fixtures/wireshark-tshark/networking.pcapng", import.meta.url),
);

it("profiles independent offline media captures with bounded private frame evidence", async (ctx) => {
  const paths = {
    wifi: "captures/private-wifi.pcapng",
    ble: "captures/private-ble.pcapng",
    "ble-hci": "captures/private-ble-hci.pcapng",
    usb: "captures/private-usb.pcapng",
    usbmon: "captures/private-usbmon.pcapng",
    voip: "captures/private-voip.pcapng",
    "voip-clipped": "captures/private-voip-clipped.pcapng",
    "voip-signaled": "captures/private-voip-signaled.pcapng",
    secrets: "captures/private-secrets.pcapng",
  };
  const media = (mediaProfile: "wifi" | "ble" | "usb" | "voip", options = {}) =>
    typed("media", { mediaProfile, source: { path: paths[mediaProfile] }, ...options });
  const voice = media("voip", { rtpPort: 5004 });
  const rig = await workbench({
    media: [
      typed("capabilities"),
      media("wifi", { limit: 1 }),
      media("wifi", { filter: "frame.number == 2" }),
      media("ble"),
      media("ble", { source: { path: paths["ble-hci"] } }),
      media("usb"),
      media("usb", { source: { path: paths.usbmon } }),
      voice,
      media("voip", { rtpPort: 5004, scanFrames: 4 }),
      media("voip", { rtpPort: 5004, filter: "frame.number == 3" }),
      media("voip"),
      media("voip", { source: { path: paths["voip-clipped"] }, rtpPort: 5004 }),
      media("voip", { source: { path: paths["voip-signaled"] } }),
      media("voip", { source: { path: paths["voip-signaled"] }, rtpPort: 5006 }),
      media("wifi", { filter: "frame.number == 99" }),
      { text: "Inspected the synthetic media captures." },
    ],
    secrets: [media("voip", { source: { path: paths.secrets } }), { text: "Capture refused." }],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    for (const [name, path] of Object.entries(paths))
      await writeFile(
        join(rig.bench, path),
        await readFile(new URL(`../fixtures/wireshark-tshark/media-${name}.pcapng`, import.meta.url)),
      );
    const service = await rig.start();
    const run = rig.session(service, "media", "read-only");
    service.send(run.id, "Analyze the saved media captures.");
    expect(await service.waitIdle(run.id)).toEqual({ stopReason: "end" });
    const [
      capabilities,
      wifi,
      protectedWifi,
      ble,
      hci,
      usb,
      usbmon,
      voip,
      prefix,
      filteredRtp,
      sipOnly,
      clippedRtp,
      signaled,
      signaledOverride,
      empty,
    ] = run.outputs.map(({ summary }) => JSON.parse(summary));
    expect(capabilities.media.profiles).toEqual(["wifi", "ble", "usb", "voip"]);
    expect(wifi).toMatchObject({
      coverage: { scannedThrough: 2, scanComplete: true, matchedInScope: 2, returned: 1, partial: true },
      media: {
        packetsOmitted: 1,
        truncatedFrames: 1,
        rows: [
          {
            frame: 1,
            fields: {
              "wlan.fc.subtype": ["8"],
              "radiotap.channel.freq": ["2412"],
              "radiotap.dbm_antsignal": ["-42"],
            },
          },
        ],
      },
    });
    expect(protectedWifi.media.rows).toMatchObject([{ frame: 2, fields: { "wlan.fc.protected": ["True"] } }]);
    expect(ble.media.rows).toMatchObject([
      { frame: 1, fields: { "btle.advertising_header.pdu_type": ["0x00"] } },
    ]);
    expect(hci.media.rows).toMatchObject([
      { frame: 1, protocols: ["bthci_evt"], fields: { "bthci_evt.le_meta_subevent": ["0x01"] } },
      { frame: 2, protocols: ["btatt"], fields: { "btatt.opcode": ["0x0a"], "btatt.handle": ["0x0003"] } },
    ]);
    expect(usb.media.rows).toMatchObject([
      { frame: 1, fields: { "usb.transfer_type": ["0x03"], "usb.endpoint_address": ["0x81"] } },
      { frame: 2, fields: { "usb.usbd_status": ["0x00000000"] } },
    ]);
    expect(usbmon.media.rows).toMatchObject([
      { frame: 1, fields: { "usb.transfer_type": ["0x03"], "usb.urb_status": ["0"] } },
      { frame: 2, fields: { "usb.endpoint_address": ["0x81"], "usb.urb_status": ["0"] } },
    ]);
    expect(voip.media.rows.map((row: { frame: number }) => row.frame)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(voip.media.rows[0].fields).toEqual({ "sip.Status-Code": ["200"] });
    expect(voip.media.rtp).toMatchObject({
      scope: "whole_capture",
      unresolvedFrames: 0,
      streams: [
        { frame: 2, packets: 3, missingSequenceNumbers: 1, maxDeltaMs: 45, jitterMs: 0.3125 },
        { frame: 5, packets: 2, missingSequenceNumbers: 0, maxDeltaMs: 22, jitterMs: null },
      ],
    });
    expect(prefix).toMatchObject({
      coverage: { scanComplete: false, scannedThrough: 4, matchedInScope: 4 },
      media: {
        rtp: {
          scope: "partial_observation",
          streams: [{ frame: 2, packets: 3, missingSequenceNumbers: null, maxDeltaMs: null, jitterMs: null }],
        },
      },
    });
    expect(filteredRtp.media.rtp).toMatchObject({
      scope: "partial_observation",
      streams: [{ frame: 3, packets: 1, jitterMs: null }],
    });
    expect(sipOnly.media).toMatchObject({ rows: [{ frame: 1 }], rtp: { streams: [] } });
    expect.soft(clippedRtp).toMatchObject({
      coverage: { scanComplete: true, matchedInScope: 5, partial: true, truncated: true },
      media: {
        truncatedFrames: 1,
        rtp: {
          scope: "partial_observation",
          streams: [
            { frame: 2, packets: 2, missingSequenceNumbers: null, maxDeltaMs: null, jitterMs: null },
            { frame: 5, packets: 2, missingSequenceNumbers: null, maxDeltaMs: null, jitterMs: null },
          ],
        },
      },
    });
    expect.soft(signaled).toMatchObject({
      analysis: { decodeAs: [] },
      media: {
        observedProtocols: { sip: 1, sdp: 1, rtp: 2 },
        rtp: {
          streams: [
            {
              frame: 2,
              packets: 2,
              missingSequenceNumbers: 0,
              maxDeltaMs: 20,
              jitterMs: null,
              limitations: ["clock_rate_unavailable"],
            },
          ],
        },
      },
    });
    expect.soft(signaledOverride.media.rtp).toMatchObject({
      streams: [
        { frame: 2, packets: 2, maxDeltaMs: 20, jitterMs: null, limitations: ["clock_rate_unavailable"] },
      ],
    });
    expect.soft(voip.media.rtp.streams[0]).toMatchObject({ jitterClock: "assumed_rtp_avp_8khz" });
    expect(empty).toMatchObject({ coverage: { matchedInScope: 0 }, media: { rows: [], evidence: [] } });
    expect(JSON.stringify(run.outputs)).not.toMatch(
      /captures\/private|192\.168\.7\.|VERA_MEDIA|12345678|frame.number/,
    );
    expect(rig.modelResults.join("\n")).not.toMatch(/captures\/private|VERA_MEDIA|192\.168\.7\./);

    const rejected = rig.session(service, "secrets", "read-only");
    const start = rig.starts.length;
    service.send(rejected.id, "Check if the saved capture is suitable.");
    await service.waitIdle(rejected.id);
    expect(JSON.parse(rejected.outputs[0]!.summary)).toMatchObject({ reason: "media_embedded_secrets" });
    expect(rig.starts.slice(start).some((args) => args.includes("-r"))).toBe(false);

    const navigation = [];
    for (const [result, path, frame, call] of [
      [wifi, paths.wifi, 1, media("wifi", { limit: 1 })],
      [protectedWifi, paths.wifi, 2, media("wifi", { filter: "frame.number == 2" })],
      [ble, paths.ble, 1, media("ble")],
      [usb, paths.usb, 2, media("usb")],
      [voip, paths.voip, 2, voice],
    ] as const) {
      const ref = result.media.evidence.find(
        (item: { frame: { number: number } }) => item.frame.number === frame,
      ).ref;
      await rig.writeReplay("media-citation", [call, { text: `See the captured packet. [[${ref}]]` }]);
      const cite = rig.session(service, "media-citation", "read-only");
      service.send(cite.id, "Cite the captured packet.");
      await service.waitIdle(cite.id);
      const assistant = service
        .get(cite.id)
        .snapshot.items.find(
          (item) =>
            item.kind === "assistant" && item.citations.some((entry) => entry.ref === ref && entry.valid),
        );
      expect(assistant).toBeDefined();
      const sourceBytes = await readFile(join(rig.bench, path));
      const sha256 = createHash("sha256").update(sourceBytes).digest("hex");
      const target = service.openCaptureCitation(cite.id, assistant?.id ?? "", ref);
      expect(target.evidence).toMatchObject({
        capture: { sha256, source: { path } },
        frame: { number: frame, interfaceId: 0 },
        analysis: {
          mediaProfile: result.analysis.mediaProfile,
          filter: result === protectedWifi ? "frame.number == 2" : null,
          decodeAs: result === voip ? [{ transport: "udp", port: 5004, protocol: "rtp" }] : [],
        },
      });
      const folder = await mkdtemp(join(rig.bench, "handoff-"));
      const snapshot = join(folder, "cited capture.pcapng");
      const prepared = await core.prepareWiresharkFrame(
        target.context,
        target.evidence,
        undefined,
        rig.runner,
        rig.tshark.executable,
        folder,
        snapshot,
        new AbortController().signal,
      );
      expect(await readFile(snapshot)).toEqual(sourceBytes);
      expect(prepared).toEqual({
        args: [
          "-n",
          "-r",
          snapshot,
          "-g",
          String(frame),
          ...(result === voip ? ["-d", "udp.port==5004,rtp"] : []),
          ...(result === protectedWifi ? ["-Y", "frame.number == 2"] : []),
        ],
        filterAdjusted: false,
      });
      navigation.push({
        sha256,
        frame,
        ref,
        args: prepared.args.map((arg) => (arg === snapshot ? "<private snapshot>" : arg)),
      });
    }
    if (evidence)
      await writeFile(
        join(evidence, `${process.platform}-media-replay.json`),
        JSON.stringify(
          { results: run.outputs.map(({ summary }) => JSON.parse(summary)), navigation },
          null,
          2,
        ),
      );
  } finally {
    await rig.close();
  }
}, 45_000);

it("compares independent saved capture pairs offline with exact report evidence", async (ctx) => {
  const paths = [
    "baseline",
    "changed",
    "equivalent",
    "unmatched",
    "cross-interface",
    "cross-vlan",
    "interface-drops",
  ].map((name) => `captures/comparison-${name}.pcapng`);
  const [baseline, changed, equivalent, unmatched, crossInterface, crossVlan, interfaceDrops] = paths as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const scope = {
    window: { startMs: 0, endMs: 500 },
    point: { section: 1, interfaceId: 0 },
    timingUncertaintyUs: 100,
  };
  const compare = (
    candidate: string,
    overrides: Record<string, unknown> = {},
    options: Record<string, unknown> = {},
  ) =>
    typed("compare", {
      baseline: { ...scope, source: { path: baseline } },
      candidate: { ...scope, source: { path: candidate }, ...overrides },
      transports: ["tcp", "udp"],
      ...options,
    });
  const planted = compare(changed);
  const rig = await workbench({
    comparison: [
      planted,
      compare(equivalent),
      compare(changed, { window: { startMs: 0, endMs: 300 } }),
      compare(changed, {}, { scanFrames: 7 }),
      compare(unmatched),
      compare(changed, { timingUncertaintyUs: null }),
      compare(
        changed,
        { window: { startMs: 0, endMs: 155 } },
        {
          baseline: { ...scope, source: { path: baseline }, window: { startMs: 0, endMs: 155 } },
        },
      ),
      compare(changed, { point: { section: 1, interfaceId: 1 } }),
      compare(crossInterface),
      compare(crossVlan),
      compare(interfaceDrops),
      compare(changed, {}, { limit: 1, reportLocale: "ro" }),
      compare(changed, {}, { baseline: { ...scope, source: { path: "captures/absent.pcapng" } } }),
      planted,
      { text: "Compared offline captures." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    const fixtures = await Promise.all(
      paths.map((path) =>
        readFile(new URL(path.replace("captures/", "../fixtures/wireshark-tshark/"), import.meta.url)),
      ),
    );
    await Promise.all(paths.map((path, index) => writeFile(join(rig.bench, path), fixtures[index]!)));
    const hashes = fixtures.map((bytes) => createHash("sha256").update(bytes).digest("hex"));
    expect(new Set(hashes).size).toBe(paths.length);
    rig.resultBudget(32_000, (text) =>
      text.replaceAll("192.168.7.10", "[masked]").replaceAll("captures/comparison-", "hidden-"),
    );

    const service = await rig.start();
    const turn = rig.session(service, "comparison", "ask");
    service.send(turn.id, "Compare the independent saved captures.");
    expect(await service.waitIdle(turn.id)).toEqual({ stopReason: "end" });
    const outputs = turn.outputs.map(({ summary }) => JSON.parse(summary));
    const [
      different,
      equal,
      incompatible,
      partial,
      unresolved,
      uncertain,
      inadequate,
      unbracketed,
      sharedInterface,
      sharedVlan,
      dropped,
      limited,
      absent,
      repeated,
    ] = outputs;
    expect(different, JSON.stringify(different)).toMatchObject({
      comparison: {
        status: "different",
        totals: { changed: 3, added: 1, missing: 1, unmatched: 0 },
        baseline: { capture: { sha256: hashes[0] }, coverage: { observedDurationMs: 500 } },
        candidate: { capture: { sha256: hashes[1] }, coverage: { observedDurationMs: 500 } },
      },
    });
    const view = different.comparison;
    expect(different).toEqual(repeated);
    expect(view.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "changed",
          transport: "tcp",
          metrics: ["volume", "retransmissions"],
          baseline: expect.objectContaining({
            aToB: { packets: 3, wireBytes: 166 },
            bToA: { packets: 2, wireBytes: 108 },
            retransmissions: 0,
          }),
          candidate: expect.objectContaining({
            aToB: { packets: 4, wireBytes: 224 },
            bToA: { packets: 2, wireBytes: 108 },
            retransmissions: 1,
            retransmissionFrame: expect.objectContaining({ frame: expect.objectContaining({ number: 6 }) }),
          }),
        }),
        expect.objectContaining({
          kind: "changed",
          metrics: ["dns"],
          baseline: expect.objectContaining({
            dns: expect.objectContaining({ samples: 2, minMs: 10, medianMs: 15, p95Ms: 20, maxMs: 20 }),
          }),
          candidate: expect.objectContaining({
            dns: expect.objectContaining({ samples: 2, minMs: 10, medianMs: 25, p95Ms: 40, maxMs: 40 }),
          }),
        }),
        expect.objectContaining({
          kind: "changed",
          metrics: ["http"],
          baseline: expect.objectContaining({ http: expect.objectContaining({ samples: 2, medianMs: 15 }) }),
          candidate: expect.objectContaining({ http: expect.objectContaining({ samples: 2, medianMs: 45 }) }),
        }),
        expect.objectContaining({ kind: "added", baseline: null }),
        expect.objectContaining({ kind: "missing", candidate: null }),
      ]),
    );
    for (const hash of hashes.slice(0, 2)) expect(different.report).toContain(hash);
    expect(different.report).toContain("500 ms");
    expect(different.report).toContain("15");
    expect(equal.comparison).toMatchObject({ status: "equivalent", rows: [] });
    expect(incompatible.comparison).toMatchObject({
      status: "incomparable",
      diagnostics: expect.arrayContaining(["window_duration_mismatch"]),
    });
    expect(partial.comparison).toMatchObject({
      status: "incomparable",
      baseline: { coverage: { scanComplete: false, diagnostics: expect.arrayContaining(["scan_limit"]) } },
      candidate: { coverage: { scanComplete: false } },
    });
    expect(partial.comparison.totals).toMatchObject({ added: 0, missing: 0, changed: 0 });
    expect(unresolved.comparison).toMatchObject({
      status: "partial",
      candidate: { coverage: { unresolvedFrames: 1, unresolvedTransports: ["udp"] } },
      totals: { added: 0, missing: 0, changed: 2, unmatched: 3 },
    });
    expect(uncertain.comparison).toMatchObject({
      status: "partial",
      diagnostics: expect.arrayContaining(["clock_uncertainty_unknown"]),
    });
    expect(uncertain.comparison.rows.flatMap((row: { metrics: string[] }) => row.metrics)).not.toContain(
      "dns",
    );
    expect(inadequate.comparison).toMatchObject({
      status: "partial",
      diagnostics: expect.arrayContaining(["timing_insufficient"]),
      rows: expect.arrayContaining([
        expect.objectContaining({ kind: "timing_unavailable", withheldTiming: ["dns"] }),
      ]),
    });
    expect(unbracketed.comparison).toMatchObject({
      status: "incomparable",
      candidate: { coverage: { diagnostics: ["window_not_bracketed"], observedDurationMs: null } },
    });
    for (const shared of [sharedInterface, sharedVlan]) {
      expect(shared.comparison).toMatchObject({
        status: "partial",
        totals: { changed: 0, added: 0, missing: 0 },
        candidate: { coverage: { diagnostics: ["shared_native_context"] } },
        rows: expect.arrayContaining([
          expect.objectContaining({
            kind: "unmatched",
            metrics: [],
            candidate: expect.objectContaining({ retransmissions: null }),
          }),
        ]),
      });
    }
    expect(dropped.comparison).toMatchObject({
      status: "incomparable",
      totals: { changed: 0, added: 0, missing: 0 },
      candidate: {
        coverage: {
          knownDrops: null,
          interfaceDropCounters: { interface: "9", operatingSystem: "2" },
          diagnostics: ["reported_drops"],
        },
      },
    });
    expect(dropped.report).toContain("9 / 2");
    expect(limited.comparison).toMatchObject({ omittedRows: 4, rows: [expect.anything()] });
    expect(limited.report).toContain("Comparație");
    expect(absent).toMatchObject({ isError: true });

    const dns = view.rows.find((row: { metrics: string[] }) => row.metrics.includes("dns"));
    const [before, after] = [dns.baseline.dns.frames, dns.candidate.dns.frames];
    expect(before.map((item: { frame: { number: number } }) => item.frame.number)).toEqual([7, 8, 9, 10]);
    expect(after.map((item: { frame: { number: number } }) => item.frame.number)).toEqual([8, 9, 10, 11]);
    const refs = [before[3].ref, after[3].ref] as string[];
    for (const ref of refs) expect(different.report).toContain(`[[${ref}]]`);
    expect(different.report).not.toContain("192.168.7.10");
    expect(different.report).toContain("[masked]");
    expect(rig.modelResults.filter((result) => result.includes('"comparison"')).join("\n")).not.toContain(
      "captures/comparison-",
    );
    await rig.writeReplay("comparison-cite", [
      planted,
      { toolCalls: [{ name: "artifact_save", args: { name: "comparison.md", content: different.report } }] },
      { text: `Baseline [[${refs[0]}]] and candidate [[${refs[1]}]].` },
    ]);
    const citation = rig.session(service, "comparison-cite", "ask");
    service.send(citation.id, "Cite a frame in each capture.");
    expect(await service.waitIdle(citation.id)).toEqual({ stopReason: "end" });
    const report = service.listArtifacts(citation.id).find(({ name }) => name === "comparison.md");
    expect(report, JSON.stringify(citation.outputs.map(({ ok }) => ok))).toBeDefined();
    expect((await service.openArtifact(report?.artifactId ?? "")).content).toBe(different.report);
    const assistant = service
      .get(citation.id)
      .snapshot.items.find(
        (item) =>
          item.kind === "assistant" &&
          refs.every((ref) => item.citations.some((entry) => entry.ref === ref && entry.valid)),
      );
    expect(assistant).toBeDefined();
    for (const [index, ref] of refs.entries()) {
      expect(service.openCaptureCitation(citation.id, assistant?.id ?? "", ref).evidence).toMatchObject({
        capture: { sha256: hashes[index], source: { kind: "workbench", path: paths[index] } },
        frame: { number: 10 + index, interfaceId: 0 },
      });
    }
    for (const [index, path] of paths.entries()) {
      const bytes = await readFile(join(rig.bench, path));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(hashes[index]);
    }
    if (process.env.VERA_COMPARISON_EVIDENCE) {
      await writeFile(
        join(process.env.VERA_COMPARISON_EVIDENCE, `${process.platform}-comparison.json`),
        JSON.stringify({ version: rig.tshark.version, hashes, outputs }, null, 2),
      );
      await writeFile(
        join(process.env.VERA_COMPARISON_EVIDENCE, `${process.platform}-comparison.md`),
        different.report,
      );
    }
  } finally {
    await rig.close();
  }
}, 60_000);

it("validates native capture-file operations and reusable managed outputs", async (ctx) => {
  const source = { path: "captures/sample.pcapng" };
  const classic = { path: classicPath };
  const untimed = { path: "captures/untimed.pcapng" };
  const derive = deriveFile;
  const rig = await workbench({
    files: [
      typed("capabilities"),
      typed("file_metadata", { source }),
      typed("file_metadata", { source: classic }),
      derive("select", { source, selection: { kind: "frames", ranges: [{ first: 2, last: 3 }] } }),
      derive("select", { source, selection: { kind: "filter", filter: "coap" } }),
      derive("select", { source, selection: { kind: "time", from: "1767225600.2", until: "1767225600.4" } }),
      derive("split", { source, by: { kind: "count", packets: 3 } }),
      derive("split", { source, by: { kind: "time", seconds: "0.3" } }),
      derive("merge", { sources: [source, classic] }),
      derive("convert", { source, outputFormat: "pcap" }),
      derive("deduplicate", { source, window: 5 }),
      derive("export_fields", { source, fields: ["udp.dstport"] }),
      typed("file_metadata", { source: untimed }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native Wireshark utilities are required.");
      ctx.skip("Native Wireshark utilities are unavailable.");
      return;
    }
    await writeFile(join(rig.bench, classicPath), classicPcap);
    await writeFile(join(rig.bench, untimed.path), await readFile(untimedSample));
    const service = await rig.start();
    const turn = rig.session(service, "files", "ask");
    service.send(turn.id, "Derive verified saved captures and retain local evidence.");
    expect(await service.waitIdle(turn.id)).toEqual({ stopReason: "end" });
    const result = turn.outputs.map(({ summary }) => JSON.parse(summary));
    if (!result[0]?.fileOperations?.select?.available && process.env.VERA_REQUIRE_TSHARK !== "1") {
      ctx.skip("Native capture-file utilities are unavailable.");
      return;
    }
    expect(result[0], turn.outputs[0]?.summary).toMatchObject({
      fileOperations: { select: { available: true } },
    });
    expect(
      turn.outputs.filter(({ ok }) => !ok),
      JSON.stringify(result),
    ).toEqual([]);
    expect(result[1]).toMatchObject({
      metadata: { packets: 8, encapsulation: "ether", interfaces: [{ linkType: 1 }] },
    });
    expect(await readFile(sample).then((bytes) => createHash("sha256").update(bytes).digest("hex"))).toBe(
      result[1].capture.sha256,
    );
    expect(result[2]).toMatchObject({ metadata: { packets: 1, earliestEpoch: "1.500000000" } });
    expect(result[3].outputs[0]).toMatchObject({ packets: 2, lineage: { ranges: [[1, 0, 2, 2]] } });
    expect(result[4].outputs[0].packets).toBe(4);
    expect(result[5].outputs[0].lineage.ranges).toEqual([[1, 0, 3, 2]]);
    expect(result[6].outputs.map((out: { packets: number }) => out.packets)).toEqual([3, 3, 2]);
    expect(result[7].outputs.map((out: { packets: number }) => out.packets)).toEqual([3, 3, 2]);
    expect(result[8].outputs[0]).toMatchObject({
      packets: 9,
      lineage: {
        ranges: [
          [1, 1, 1, 1],
          [2, 0, 1, 8],
        ],
      },
    });
    expect(result[9].outputs[0].capture.fileFormat).toBe("pcap");
    expect(result[10].outputs[0].packets).toBe(8);
    expect(result[11]).toMatchObject({ export: { records: 8, partial: false } });
    expect(result[12]).toMatchObject({
      metadata: { framesWithoutTimestamp: 1, chronological: null, packets: 3 },
    });
    const [fields] = service.listArtifacts(turn.id);
    const fieldReport = JSON.parse(
      await readFile(join(rig.bench, ".vera", "artifacts", turn.id, fields?.name ?? ""), "utf8"),
    );
    expect(fieldReport).toMatchObject({
      source: result[1].capture,
      coverage: { partial: false, records: 8 },
      rows: expect.arrayContaining([
        {
          frame: expect.objectContaining({ number: 3 }),
          fields: { "udp.dstport": ["5683"] },
          truncated: false,
          wireBytes: expect.any(Number),
          capturedBytes: expect.any(Number),
        },
      ]),
    });
    const reopened = await reopenDerived(rig, service, result);
    const capture = result[3].outputs[0].capture;
    await rig.writeReplay("reused", [
      typed("frame", { source: { reference: capture }, frame: 2 }),
      { text: "Done." },
    ]);
    const reused = rig.session(service, "reused", "ask");
    service.send(reused.id, "Read a derived frame through its managed identity.");
    await service.waitIdle(reused.id);
    const frame = JSON.parse(reused.outputs[0]?.summary ?? "{}");
    expect(frame).toMatchObject({ capture, columns: expect.arrayContaining(["frame", "ref"]) });
    expect(frame.rows).toHaveLength(1);
    expect(frame.rows[0][0]).toBe(2);
    const derivedRef: string = frame.rows[0][frame.columns.indexOf("ref")];
    expect(derivedRef).toMatch(/^capture:[a-f0-9]{64}#f=2$/);
    await rig.writeReplay("reused-citation", [
      typed("frame", { source: { reference: capture }, frame: 2 }),
      { text: `The derived frame. [[${derivedRef}]]` },
    ]);
    const citation = rig.session(service, "reused-citation", "ask");
    service.send(citation.id, "Cite the exact derived frame.");
    await service.waitIdle(citation.id);
    const assistant = service
      .get(citation.id)
      .snapshot.items.find(
        (item) =>
          item.kind === "assistant" && item.citations.some(({ ref, valid }) => ref === derivedRef && valid),
      );
    expect(assistant).toBeDefined();
    const located = service.openCaptureCitation(citation.id, assistant?.id ?? "", derivedRef);
    const viewer = await mkdtemp(join(rig.bench, "viewer-"));
    const viewerCopy = join(viewer, "derived.pcapng");
    const open = await core.prepareWiresharkFrame(
      located.context,
      located.evidence,
      undefined,
      rig.runner,
      rig.tshark.executable,
      viewer,
      viewerCopy,
      AbortSignal.timeout(captureLimits.deadlineMs),
    );
    expect(open.args).toEqual(["-n", "-r", viewerCopy, "-g", "2"]);
    expect(
      createHash("sha256")
        .update(await readFile(viewerCopy))
        .digest("hex"),
    ).toBe(capture.sha256);
    expect(await readFile(join(rig.bench, source.path))).toEqual(await readFile(sample));
    expect(await readFile(join(rig.bench, classicPath))).toEqual(classicPcap);
    if (evidence)
      await writeFile(
        join(evidence, `${process.platform}-capture-operations.json`),
        JSON.stringify(
          { result, fieldReport, reopened, reused: reused.outputs, navigation: located.evidence },
          null,
          2,
        ),
      );
  } finally {
    await rig.close();
  }
}, 90_000);

const deriveFile = (operation: string, args: Record<string, unknown>) => ({
  toolCalls: [{ name: "wireshark_derive", args: { operation, ...args } }],
});

const firmwareHex = "captures/firmware-ethernet.hex";
const uartHex = "captures/uart-payload.hex";
const hexdump = (path: string, encapsulation: object, timestamps = "synthetic") =>
  deriveFile("import_hexdump", {
    path,
    hexdumpProfile: { parser: "ascii-offset-v1", encapsulation, timestamps },
  });
const opaqueHex = { kind: "user0" };
const udpHex = { kind: "udp_ipv4", sourcePort: 32101, destinationPort: 32102 };
const ethernetHex = { kind: "ethernet" };
const hexFixture = (path: string) =>
  readFile(new URL(path.replace("captures/", "../fixtures/wireshark-tshark/"), import.meta.url));
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

it("imports profiled hexdumps and verifies native packet readback and managed provenance", async (ctx) => {
  const rig = await workbench({
    hexdump: [
      typed("capabilities"),
      hexdump(firmwareHex, ethernetHex, "trace_utc"),
      hexdump(uartHex, opaqueHex),
      hexdump(uartHex, udpHex),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    const firmware = await hexFixture(firmwareHex);
    const uart = Buffer.from((await hexFixture(uartHex)).toString("ascii").replaceAll("\n", "\r\n"));
    await writeFile(join(rig.bench, firmwareHex), firmware);
    await writeFile(join(rig.bench, uartHex), uart);
    const service = await rig.start();
    const turn = rig.session(service, "hexdump", "ask");
    service.send(turn.id, "Import the independent firmware and UART fixtures.");
    await service.waitIdle(turn.id);
    const [capabilities, raw, opaque, udp] = turn.outputs.map(({ summary }) => JSON.parse(summary));
    if (!capabilities?.fileOperations?.importHexdump?.available && process.env.VERA_REQUIRE_TSHARK !== "1") {
      ctx.skip("Native Text2pcap is unavailable.");
      return;
    }
    expect(capabilities, turn.outputs[0]?.summary).toMatchObject({
      utilities: { text2pcap: { available: true, version: expect.stringMatching(/^\d+\.\d+\.\d+$/) } },
      fileOperations: { importHexdump: { available: true } },
    });
    expect(
      turn.outputs.every(({ ok }) => ok),
      JSON.stringify(turn.outputs),
    ).toBe(true);
    const managed = join(rig.bench, ".vera", "captures");
    const native = async (capture: CaptureReference, args: string[]) => {
      if (!rig.tshark) throw Error("Native TShark is required.");
      const { stdout } = await promisify(execFile)(
        rig.tshark.executable,
        ["-n", "-r", join(managed, `${capture.sha256}.pcapng`), ...args],
        {
          timeout: 10_000,
          windowsHide: true,
          env: { ...process.env, ...core.captureProfileEnvironment(rig.bench) },
        },
      );
      return stdout.trim();
    };
    const nativeReadback = [];
    for (const [result, input, encapsulation, origin, headers] of [
      [raw, firmware, ethernetHex, "trace", []],
      [opaque, uart, opaqueHex, "synthetic", []],
      [udp, uart, udpHex, "synthetic", ["ethernet", "ipv4", "udp"]],
    ] as const) {
      const capture = captureReferenceSchema.parse(result.capture);
      const body = await readFile(join(managed, `${capture.sha256}.pcapng`));
      const manifest = await readFile(join(managed, `${result.manifest.sha256}.provenance.json`));
      expect(capture).toMatchObject({
        source: { kind: "managed" },
        bytes: body.length,
        sha256: sha256(body),
        fileFormat: "pcapng",
      });
      expect(result.manifest).toEqual({ bytes: manifest.length, sha256: sha256(manifest) });
      expect(JSON.parse(manifest.toString())).toEqual(result.provenance);
      expect(result).toMatchObject({
        complete: true,
        provenance: {
          format: 1,
          source: { sha256: sha256(input), bytes: input.length },
          profile: { parser: "ascii-offset-v1", encapsulation },
          tool: { name: "text2pcap", version: capabilities.utilities.text2pcap.version },
          timestamps: { origin, synthetic: origin === "synthetic" },
          syntheticHeaders: headers,
          capture,
          packets: 2,
        },
      });
      const fields = await native(capture, [
        "-T",
        "fields",
        "-e",
        "frame.number",
        "-e",
        "frame.time_epoch",
        "-e",
        "frame.len",
        "-e",
        "ip.src",
        "-e",
        "ip.dst",
        "-e",
        "udp.srcport",
        "-e",
        "udp.dstport",
        "-e",
        "udp.payload",
      ]);
      const frames = JSON.parse(await native(capture, ["-T", "jsonraw"])).map(
        (row: { _source: { layers: { frame_raw: [string] } } }) => row._source.layers.frame_raw[0],
      );
      nativeReadback.push({ fields: fields.split(/\r?\n/).map((line) => line.trimEnd()), frames });
    }
    expect(nativeReadback[0]).toEqual({
      fields: ["1\t1773500966.123456789\t20", "2\t1773500965.987654321\t19"],
      frames: ["00112233445566778899aabb88b5cafe01020304", "0123456789ab020406080a0c88b5f00db00b1e"],
    });
    expect(nativeReadback[1]).toEqual({
      fields: ["1\t946684800.000000000\t4", "2\t946684800.000001000\t5"],
      frames: ["deadbeef", "13370055aa"],
    });
    expect(nativeReadback[2]?.fields).toEqual([
      "1\t946684800.000000000\t60\t192.0.2.1\t192.0.2.2\t32101\t32102\tdeadbeef",
      "2\t946684800.000001000\t60\t192.0.2.1\t192.0.2.2\t32101\t32102\t13370055aa",
    ]);
    await rig.writeReplay("verify-hexdump", [
      typed("verify_reference", { source: { reference: raw.capture } }),
      { text: "Done." },
    ]);
    const reopen = rig.session(service, "verify-hexdump", "ask");
    service.send(reopen.id, "Reopen the managed import.");
    await service.waitIdle(reopen.id);
    expect(JSON.parse(reopen.outputs[0]?.summary ?? "{}")).toEqual({ capture: raw.capture, verified: true });
    expect(await readFile(join(rig.bench, firmwareHex))).toEqual(firmware);
    expect(await readFile(join(rig.bench, uartHex))).toEqual(uart);
    if (evidence)
      await writeFile(
        join(evidence, `${process.platform}-hexdump-readback.json`),
        JSON.stringify({ capabilities, raw, opaque, udp, nativeReadback, reopen: reopen.outputs }, null, 2),
      );
  } finally {
    await rig.close();
  }
}, 90_000);

it("rejects unsafe, incomplete and cancelled hexdumps without publishing a capture or manifest", async (ctx) => {
  const rejected = [
    ["bad-byte", "000 00\n001 0G\n", opaqueHex, "synthetic", "hexdump_malformed", "line 2"],
    ["bad-offset", "000 00\n002 01\n", opaqueHex, "synthetic", "hexdump_malformed", "line 2"],
    ["non-ascii", Buffer.from("000 00\n000 ż\n"), opaqueHex, "synthetic", "hexdump_malformed", "line 2"],
    ["bad-date", "@2026-02-30T00:00:00Z\n000 ff\n", opaqueHex, "trace_utc", "hexdump_malformed", "line 1"],
    ["short-frame", "000 ab\n", ethernetHex, "synthetic", "hexdump_incompatible", "line 1"],
    ["no-time", "000 ff\n", opaqueHex, "trace_utc", "hexdump_incompatible", "line 1"],
    [
      "extra-time",
      "@2026-11-25T00:00:00Z\n000 ff\n",
      opaqueHex,
      "synthetic",
      "hexdump_incompatible",
      "line 1",
    ],
    [
      "large-input",
      Buffer.alloc(4 * 1024 * 1024 + 1, 32),
      opaqueHex,
      "synthetic",
      "hexdump_input_limit",
      "smaller",
    ],
    [
      "large-packet",
      Array.from({ length: 513 }, (_, i) => (i * 32).toString(16).padStart(3, "0") + " ff".repeat(32)).join(
        "\n",
      ),
      opaqueHex,
      "synthetic",
      "hexdump_packet_limit",
      "line 513",
    ],
    ["too-many", "000 ff\n".repeat(10_001), opaqueHex, "synthetic", "hexdump_packet_limit", "line 10001"],
  ] as const;
  const valid = hexdump(uartHex, opaqueHex);
  const rig = await workbench({
    readinessHex: [typed("capabilities"), { text: "Done." }],
    rejectedHex: [
      ...rejected.map(([name, , kind, time]) => hexdump(`captures/${name}.hex`, kind, time)),
      hexdump("../outside.hex", opaqueHex),
      { text: "Done." },
    ],
    partialHex: [valid, { text: "Done." }],
    changedHex: [valid, { text: "Done." }],
    badMetadataHex: [valid, { text: "Done." }],
    largeHex: [valid, { text: "Done." }],
    cancelHex: [valid, { text: "Done." }],
    readonlyHex: [valid, { text: "Done." }],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    const uart = await hexFixture(uartHex);
    await writeFile(join(rig.bench, uartHex), uart);
    await writeFile(join(rig.bench, "../outside.hex"), uart);
    for (const [name, bytes] of rejected) await writeFile(join(rig.bench, "captures", `${name}.hex`), bytes);
    const service = await rig.start();
    const readiness = rig.session(service, "readinessHex", "ask");
    service.send(readiness.id, "Check the installed hexdump converter.");
    await service.waitIdle(readiness.id);
    const status = JSON.parse(readiness.outputs[0]?.summary ?? "{}");
    if (!status?.fileOperations?.importHexdump?.available && process.env.VERA_REQUIRE_TSHARK !== "1") {
      ctx.skip("Native Text2pcap is unavailable.");
      return;
    }
    expect(status.fileOperations.importHexdump).toEqual({ available: true });
    const managed = join(rig.bench, ".vera", "captures");
    const run = async (name: string, mode: "ask" | "read-only" = "ask") => {
      const turn = rig.session(service, name, mode);
      service.send(turn.id, "Check the failure boundary.");
      await service.waitIdle(turn.id);
      expect(turn.outputs.every(({ ok }) => !ok)).toBe(true);
      await expect(readdir(managed)).rejects.toMatchObject({ code: "ENOENT" });
      return turn.outputs.map(({ summary }) => JSON.parse(summary));
    };
    const failures = await run("rejectedHex");
    rejected.forEach(([, , , , reason, phrase], i) => {
      expect(failures[i]).toMatchObject({ reason, error: expect.stringContaining(phrase) });
    });
    expect(failures.at(-1)).toMatchObject({ reason: "hexdump_inaccessible" });
    expect(await run("readonlyHex", "read-only")).toMatchObject([{ reason: "storage_read_only" }]);
    const captureBytes = rig.runner.captureBytes.bind(rig.runner);
    const conversions = [];
    for (const [name, modify, reason] of [
      ["partialHex", (bytes: Buffer) => bytes.subarray(0, -1), "hexdump_output_invalid"],
      [
        "changedHex",
        (bytes: Buffer) => {
          const at = bytes.indexOf(Buffer.from("deadbeef", "hex"));
          expect(at).toBeGreaterThan(0);
          const changed = Buffer.from(bytes);
          changed[at] = 0;
          return changed;
        },
        "hexdump_output_invalid",
      ],
      [
        "badMetadataHex",
        (bytes: Buffer) => Buffer.concat([bytes, pcapngBlock(4, Buffer.alloc(0))]),
        "hexdump_output_invalid",
      ],
      ["largeHex", undefined, "capture_output_limit"],
    ] as const) {
      rig.runner.captureBytes = async (request) => {
        const result = await captureBytes(request);
        if (!request.args.includes("hex-input.txt")) return result;
        expect(request.maxBytes).toBe(8 * 1024 * 1024);
        return modify
          ? { ...result, stdout: Buffer.from(modify(result.stdout)) }
          : { ...result, exceeded: true, stdout: Buffer.alloc(request.maxBytes) };
      };
      const failure = await run(name);
      expect(failure).toMatchObject([{ reason }]);
      conversions.push(...failure);
    }
    rig.runner.captureBytes = captureBytes;
    const cancelled = rig.session(service, "cancelHex", "ask");
    let stopped = false;
    rig.onNativeStart((argv) => {
      if (argv.includes("hex-input.txt")) stopped = service.stop(cancelled.id);
    });
    service.send(cancelled.id, "Cancel the converter as it starts.");
    const settlement = await service.waitIdle(cancelled.id);
    expect(stopped).toBe(true);
    expect(settlement).toEqual({ stopReason: "aborted" });
    expect(cancelled.outputs).toEqual([{ ok: false, summary: "Aborted." }]);
    await expect(readdir(managed)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(rig.bench, uartHex))).toEqual(uart);
    expect(await readFile(join(rig.bench, "../outside.hex"))).toEqual(uart);
    for (const [name, bytes] of rejected)
      expect(sha256(await readFile(join(rig.bench, "captures", `${name}.hex`)))).toBe(
        sha256(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)),
      );
    if (evidence)
      await writeFile(
        join(evidence, `${process.platform}-hexdump-refusals.json`),
        JSON.stringify({ failures, conversions, cancelled: cancelled.outputs, settlement, stopped }, null, 2),
      );
  } finally {
    await rig.close();
  }
}, 90_000);

it("keeps saved captures ready when the hexdump converter is missing", async (ctx) => {
  const rig = await workbench(
    { missingHex: [typed("capabilities"), hexdump(uartHex, opaqueHex), { text: "Done." }] },
    "no_text2pcap",
  );
  try {
    expect(deriveCaptureToolSchema.safeParse({ operation: "import_hexdump", path: uartHex }).success).toBe(
      false,
    );
    expect(
      deriveCaptureToolSchema.safeParse(hexdump(uartHex, { ...udpHex, sourcePort: 0 }).toolCalls[0]?.args)
        .success,
    ).toBe(false);
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    await writeFile(join(rig.bench, uartHex), await hexFixture(uartHex));
    const service = await rig.start();
    const turn = rig.session(service, "missingHex", "ask");
    service.send(turn.id, "Check readiness without the converter.");
    await service.waitIdle(turn.id);
    const [capabilities, failure] = turn.outputs.map(({ summary }) => JSON.parse(summary));
    expect(capabilities).toMatchObject({
      tshark: { available: true },
      utilities: { text2pcap: { available: false } },
      fileOperations: {
        importHexdump: { available: false, missing: ["text2pcap"] },
      },
    });
    expect(failure).toMatchObject({
      reason: "utility_unavailable",
      error: expect.stringContaining("text2pcap"),
    });
    await expect(readdir(join(rig.bench, ".vera", "captures"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rig.close();
  }
}, 90_000);

async function reopenDerived(
  rig: Awaited<ReturnType<typeof workbench>>,
  service: core.SessionService,
  results: { outputs?: { capture: CaptureReference; packets: number }[] }[],
) {
  const outputs = new Map(
    results.flatMap((result) => result.outputs ?? []).map((item) => [item.capture.sha256, item] as const),
  );
  await rig.writeReplay("reopen-batch", [
    ...[...outputs.values()].map(({ capture }) => typed("inspect", { source: { reference: capture } })),
    { text: "Done." },
  ]);
  const session = rig.session(service, "reopen-batch", "ask");
  service.send(session.id, "Reopen every derived capture using the ordinary analysis tool.");
  await service.waitIdle(session.id);
  expect(session.outputs).toHaveLength(outputs.size);
  for (const [i, expected] of [...outputs.values()].entries()) {
    expect(JSON.parse(session.outputs[i]?.summary ?? "{}")).toMatchObject({
      capture: expected.capture,
      coverage: { scannedThrough: expected.packets, scanComplete: true },
    });
  }
  return session.outputs;
}

function pcapngBlock(type: number, content: Buffer) {
  const block = Buffer.alloc(12 + Math.ceil(content.length / 4) * 4);
  block.writeUInt32LE(type);
  block.writeUInt32LE(block.length, 4);
  block.writeUInt32LE(block.length, block.length - 4);
  content.copy(block, 8);
  return block;
}

function pcapngComment(text: string) {
  const comment = Buffer.from(text);
  const option = Buffer.alloc(8 + Math.ceil(comment.length / 4) * 4);
  option.writeUInt16LE(1);
  option.writeUInt16LE(comment.length, 2);
  comment.copy(option, 4);
  return option;
}

function fileFixture(frames: { time: number; data: Buffer; link?: number }[], secret = false) {
  const packetBytes = (data: Buffer) => Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const header = Buffer.from("4d3c2b1a01000000ffffffffffffffff", "hex");
  const iface = (link: number) => Buffer.from([link, 0, 0, 0, 255, 255, 0, 0]);
  const blocks = [
    pcapngBlock(
      0x0a0d0d0a,
      secret ? Buffer.concat([header, pcapngComment("synthetic capture note")]) : header,
    ),
    pcapngBlock(1, iface(1)),
  ];
  if (frames.some(({ link }) => link === 101)) blocks.push(pcapngBlock(1, iface(101)));
  if (secret) {
    const data = Buffer.from(`CLIENT_RANDOM ${"0".repeat(64)} ${"1".repeat(96)}\n`);
    const prefix = Buffer.from("4b534c5400000000", "hex");
    prefix.writeUInt32LE(data.length, 4);
    blocks.push(pcapngBlock(10, Buffer.concat([prefix, data])));
  }
  for (const [i, { time, data, link }] of frames.entries()) {
    const prefix = Buffer.alloc(20);
    prefix.writeUInt32LE(link === 101 ? 1 : 0);
    prefix.writeUInt32LE(time, 8);
    prefix.writeUInt32LE(data.length, 12);
    prefix.writeUInt32LE(data.length, 16);
    const comment = secret && i === 0 ? pcapngComment("synthetic packet note") : Buffer.alloc(0);
    blocks.push(pcapngBlock(6, Buffer.concat([prefix, packetBytes(data), comment])));
  }
  return Buffer.concat(blocks);
}

function httpFrame() {
  const message = Buffer.from(
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\n\r\nVERA!!",
  );
  const prefix = Buffer.from(
    "0200000000020200000000010800450000000001000040060000c0000201c00002020050bf3f00000001000000015018ffff00000000",
    "hex",
  );
  prefix.writeUInt16BE(prefix.length - 14 + message.length, 16);
  return Buffer.concat([prefix, message]);
}

it("verifies native capture cleanup, reordering, deduplication and local exports", async (ctx) => {
  const unordered = { path: "captures/unordered.pcapng" };
  const source = { path: "captures/cleanup.pcapng" };
  const classic = { path: classicPath };
  const http = { path: "captures/http.pcapng" };
  const sampleSource = { path: "captures/sample.pcapng" };
  const a = classicPcap.subarray(40);
  const b = Buffer.from(a);
  b[b.length - 1] = 2;
  const httpFixture = fileFixture([{ time: 2_000_000, data: httpFrame() }]);
  const fixture = fileFixture([
    { time: 3_000_000, data: a },
    { time: 1_000_000, data: b },
    { time: 2_000_000, data: a },
  ]);
  const cleanup = fileFixture([{ time: 3_000_000, data: a }], true);
  const rig = await workbench({
    files: [
      typed("capabilities"),
      typed("file_metadata", { source }),
      deriveFile("clean", { source, remove: ["packet_comments"] }),
      deriveFile("clean", { source, remove: ["capture_comments", "packet_comments", "secrets"] }),
      deriveFile("reorder", { source: unordered }),
      deriveFile("deduplicate", { source: unordered, window: 3 }),
      deriveFile("merge", { sources: [classic, classic] }),
      deriveFile("export_pdus", { source: sampleSource, tap: "ethernet", filter: "coap" }),
      deriveFile("export_objects", { source: http, protocol: "http" }),
      deriveFile("select", {
        source: sampleSource,
        selection: { kind: "filter", filter: "frame.number == 99" },
      }),
      { text: "Done." },
    ],
    masked: [
      deriveFile("export_objects", { source: http, protocol: "http" }),
      deriveFile("export_fields", { source: sampleSource, fields: ["udp.dstport"] }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native Wireshark utilities are required.");
      ctx.skip("Native Wireshark utilities are unavailable.");
      return;
    }
    await writeFile(join(rig.bench, classicPath), classicPcap);
    await writeFile(join(rig.bench, unordered.path), fixture);
    await writeFile(join(rig.bench, source.path), cleanup);
    await writeFile(join(rig.bench, http.path), httpFixture);
    const service = await rig.start();
    const turn = rig.session(service, "files", "ask");
    service.send(turn.id, "Transform the independent captures and save supported exports.");
    await service.waitIdle(turn.id);
    const out = turn.outputs.map(({ summary }) => JSON.parse(summary));
    if (!out[0]?.fileOperations?.select?.available && process.env.VERA_REQUIRE_TSHARK !== "1") {
      ctx.skip("Native capture-file utilities are unavailable.");
      return;
    }
    expect(
      turn.outputs.filter(({ ok }) => !ok),
      JSON.stringify(out),
    ).toEqual([]);
    expect(out[1].metadata.metadataCounts).toEqual({ capture_comments: 1, packet_comments: 1, secrets: 1 });
    expect(out[2].outputs[0].metadataCounts).toEqual({ capture_comments: 1, packet_comments: 0, secrets: 1 });
    expect(out[3]).toMatchObject({
      packetDataAndIdentifiersMayRemain: true,
      removed: { capture_comments: 1, packet_comments: 1, secrets: 1 },
      outputs: [{ metadataCounts: { capture_comments: 0, packet_comments: 0, secrets: 0 } }],
    });
    expect(out[4].outputs[0]).toMatchObject({
      chronological: true,
      lineage: {
        ranges: [
          [1, 0, 2, 2],
          [3, 0, 1, 1],
        ],
      },
    });
    expect(out[5].outputs[0]).toMatchObject({ packets: 2, lineage: { ranges: [[1, 0, 1, 2]] } });
    expect(out[6].outputs[0].lineage).toMatchObject({ ambiguous: 2, ranges: [] });
    expect(out[7]).toMatchObject({
      sources: [{ source: { path: sampleSource.path } }],
      outputs: [{ packets: 4, lineage: { mapped: 4, unavailable: 0 } }],
    });
    expect(out[8]).toMatchObject({ export: { records: 1, partial: true } });
    expect(out[9].outputs[0]).toMatchObject({ packets: 0, lineage: { ranges: [], ambiguous: 0 } });
    const reports = service.listArtifacts(turn.id);
    expect(reports).toHaveLength(1);
    const artifact = JSON.parse(
      await readFile(join(rig.bench, ".vera", "artifacts", turn.id, reports[0]?.name ?? ""), "utf8"),
    );
    expect(artifact).toMatchObject({
      source: { sha256: createHash("sha256").update(httpFixture).digest("hex") },
      rows: [
        {
          frame: 1,
          bytes: 6,
          sha256: createHash("sha256").update("VERA!!").digest("hex"),
          contentBase64: Buffer.from("VERA!!").toString("base64"),
        },
      ],
    });
    const cleaned = out[3].outputs[0].capture;
    const bytes = await readFile(join(rig.bench, ".vera", "captures", `${cleaned.sha256}.pcapng`));
    expect(bytes.includes(a)).toBe(true);
    expect(bytes.includes(Buffer.from("synthetic"))).toBe(false);
    expect(bytes.includes(Buffer.from("CLIENT_RANDOM"))).toBe(false);
    expect(await readFile(join(rig.bench, source.path))).toEqual(cleanup);
    expect(await readFile(join(rig.bench, unordered.path))).toEqual(fixture);
    const reopened = await reopenDerived(rig, service, out);
    const pdu = out[7].outputs[0].capture;
    const pduBytes = await readFile(join(rig.bench, ".vera", "captures", `${pdu.sha256}.pcapng`));
    expect(pduBytes.length).toBe(pdu.bytes);
    expect(createHash("sha256").update(pduBytes).digest("hex")).toBe(pdu.sha256);
    rig.resultBudget(32_000, (text) =>
      text
        .replaceAll(Buffer.from("VERA!!").toString("base64"), "[masked]")
        .replaceAll("5683", "[masked port]"),
    );
    const masked = rig.session(service, "masked", "ask");
    service.send(masked.id, "Apply the active export mask to the structured reports.");
    await service.waitIdle(masked.id);
    expect(masked.outputs.map(({ summary }) => JSON.parse(summary).reason)).toEqual([
      "capture_export_masked",
      "capture_export_masked",
    ]);
    expect(service.listArtifacts(masked.id)).toEqual([]);
    if (evidence)
      await writeFile(
        join(evidence, `${process.platform}-capture-cleanup-exports.json`),
        JSON.stringify({ out, artifact, reopened, masked: masked.outputs }, null, 2),
      );
  } finally {
    await rig.close();
  }
}, 90_000);

it("refuses unsafe or incomplete capture-file operations without publishing output", async (ctx) => {
  const source = { path: "captures/sample.pcapng" };
  const corrupted = { path: "captures/corrupted.pcapng" };
  const tooLarge = { path: "captures/large.pcapng" };
  const heterogeneous = { path: "captures/mixed.pcapng" };
  const journal = { path: "captures/journal.pcapng" };
  const many = { path: "captures/many.pcapng" };
  const bytes = classicPcap.subarray(40);
  const rig = await workbench({
    rejected: [
      typed("capabilities"),
      deriveFile("convert", { source: corrupted, outputFormat: "pcap" }),
      deriveFile("convert", { source: tooLarge, outputFormat: "pcap" }),
      deriveFile("convert", { source: heterogeneous, outputFormat: "pcap" }),
      deriveFile("split", { source: many, by: { kind: "count", packets: 1 } }),
      deriveFile("select", { source, selection: { kind: "filter", filter: "udp.port ==" } }),
      deriveFile("convert", { source: { path: "../foreign.pcap" }, outputFormat: "pcap" }),
      deriveFile("convert", { source: journal, outputFormat: "pcapng" }),
      { text: "Done." },
    ],
    cancelled: [deriveFile("convert", { source, outputFormat: "pcap" }), { text: "Done." }],
    readonly: [
      typed("capabilities"),
      deriveFile("convert", { source, outputFormat: "pcap" }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native Wireshark utilities are required.");
      ctx.skip("Native Wireshark utilities are unavailable.");
      return;
    }
    const valid = await readFile(sample);
    const small = fileFixture([{ time: 1_000_000, data: bytes }]);
    const journalRecord = pcapngBlock(
      9,
      Buffer.from("__REALTIME_TIMESTAMP=1767225600000000\nMESSAGE=Synthetic fixture\n\n"),
    );
    const journalPath = join(rig.bench, journal.path);
    await writeFile(journalPath, Buffer.concat([small.subarray(0, 48), journalRecord, small.subarray(48)]));
    const nativeCounts = await promisify(execFile)(
      rig.tshark.executable,
      ["-n", "-r", journalPath, "-T", "fields", "-e", "frame.number"],
      {
        timeout: 10_000,
        windowsHide: true,
        env: { ...process.env, ...core.captureProfileEnvironment(rig.bench) },
      },
    );
    expect(nativeCounts.stdout.trim().split(/\s+/)).toEqual(["1", "2"]);
    await writeFile(join(rig.bench, corrupted.path), valid.subarray(0, valid.length - 1));
    await writeFile(join(rig.bench, tooLarge.path), valid);
    await truncate(join(rig.bench, tooLarge.path), captureLimits.captureBytes + 1);
    await writeFile(
      join(rig.bench, heterogeneous.path),
      fileFixture([
        { time: 1_000_000, data: bytes },
        { time: 2_000_000, data: bytes.subarray(14), link: 101 },
      ]),
    );
    await writeFile(
      join(rig.bench, many.path),
      fileFixture(Array.from({ length: 25 }, (_, i) => ({ time: i * 100_000, data: bytes }))),
    );
    const service = await rig.start();
    const turn = rig.session(service, "rejected", "ask");
    service.send(turn.id, "Check failure boundaries of the saved captures.");
    await service.waitIdle(turn.id);
    const out = turn.outputs.map(({ summary }) => JSON.parse(summary));
    if (!out[0]?.fileOperations?.select?.available && process.env.VERA_REQUIRE_TSHARK !== "1") {
      ctx.skip("Native capture-file utilities are unavailable.");
      return;
    }
    expect(out.slice(1).map(({ reason }) => reason)).toEqual([
      "invalid_capture",
      "capture_byte_limit",
      "capture_incompatible",
      "capture_part_limit",
      "invalid_filter",
      "capture_inaccessible",
      "capture_records_unsupported",
    ]);
    expect(turn.outputs.slice(1).every(({ ok }) => !ok)).toBe(true);
    const managed = join(rig.bench, ".vera", "captures");
    const pending = rig.session(service, "cancelled", "ask");
    let stoppedAtNativeStart = false;
    rig.onNativeStart((argv) => {
      if (argv.includes("nsecpcap")) stoppedAtNativeStart = service.stop(pending.id);
    });
    service.send(pending.id, "Cancel the managed conversion.");
    const settlement = await service.waitIdle(pending.id);
    expect(stoppedAtNativeStart).toBe(true);
    expect(pending.outputs.every(({ ok }) => !ok)).toBe(true);
    const readonly = rig.session(service, "readonly", "read-only");
    service.send(readonly.id, "Check the managed write gate.");
    await service.waitIdle(readonly.id);
    expect(JSON.parse(readonly.outputs[0]?.summary ?? "{}").fileOperations.convert).toMatchObject({
      available: false,
      reason: "storage_read_only",
    });
    expect(readonly.outputs[1]?.ok).toBe(false);
    await expect(readdir(managed)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(rig.bench, source.path))).toEqual(valid);
    if (evidence)
      await writeFile(
        join(evidence, `${process.platform}-capture-refusals.json`),
        JSON.stringify(
          { out, settlement, stoppedAtNativeStart, cancelled: pending.outputs, readonly: readonly.outputs },
          null,
          2,
        ),
      );
  } finally {
    await rig.close();
  }
}, 90_000);

it("keeps every verified sparse lineage row in the managed report", async (ctx) => {
  const source = { path: "captures/sparse.pcapng" };
  const ranges = Array.from({ length: 135 }, (_, i) => ({ first: 2 * i + 1, last: 2 * i + 1 }));
  const rig = await workbench({
    sparse: [
      typed("capabilities"),
      deriveFile("select", { source, selection: { kind: "frames", ranges } }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native Wireshark utilities are required.");
      ctx.skip("Native Wireshark utilities are unavailable.");
      return;
    }
    const fixture = fileFixture(
      Array.from({ length: 270 }, (_, i) => ({ time: i * 1000, data: classicPcap.subarray(40) })),
    );
    await writeFile(join(rig.bench, source.path), fixture);
    const service = await rig.start();
    const run = async (name: string) => {
      const turn = rig.session(service, name, "ask");
      service.send(turn.id, "Read or retain the exact capture ancestry.");
      await service.waitIdle(turn.id);
      return turn.outputs.map(({ summary }) => JSON.parse(summary));
    };
    const [capability, derivation] = await run("sparse");
    if (!capability?.fileOperations?.select?.available && process.env.VERA_REQUIRE_TSHARK !== "1") {
      ctx.skip("Native capture-file utilities are unavailable.");
      return;
    }
    expect(derivation).toMatchObject({
      complete: true,
      outputs: [{ packets: 135, lineage: { rangeCount: 135 } }],
    });
    expect(derivation.outputs[0].lineage.ranges).toHaveLength(128);
    const report = derivation.lineageReport;
    await rig.writeReplay("full-lineage", [
      typed("file_lineage", { report, part: 1 }),
      typed("file_lineage", { report, part: 1, offset: 100 }),
      { text: "Done." },
    ]);
    const [page1, page2] = await run("full-lineage");
    expect(page1).toMatchObject({
      nextOffset: 100,
      offset: 0,
      total: 135,
      kind: "packet_ranges",
      unavailable: 0,
      capture: derivation.outputs[0].capture,
      sourceSha256: [createHash("sha256").update(fixture).digest("hex")],
    });
    expect(page2).toMatchObject({ nextOffset: null, offset: 100, total: 135 });
    expect([...page1.rows, ...page2.rows]).toEqual(ranges.map(({ first }, i) => [i + 1, 0, first, 1]));
    const savedPath = join(rig.bench, ".vera", "captures", `${report.sha256}.lineage.json`);
    const saved = await readFile(savedPath);
    expect(createHash("sha256").update(saved).digest("hex")).toBe(report.sha256);
    saved[1] = (saved[1] ?? 0) ^ 1;
    await writeFile(savedPath, saved);
    await rig.writeReplay("tampered-lineage", [
      typed("file_lineage", { report, part: 1 }),
      { text: "Done." },
    ]);
    const [altered] = await run("tampered-lineage");
    expect(altered).toMatchObject({ isError: true, reason: "capture_changed" });
    if (evidence)
      await writeFile(
        join(evidence, `${process.platform}-capture-lineage.json`),
        JSON.stringify({ derivation, pages: [page1, page2], altered }, null, 2),
      );
  } finally {
    await rig.close();
  }
}, 90_000);

it("keeps TShark analysis ready when the capture-file utilities are unavailable", async (ctx) => {
  const source = { path: "captures/sample.pcapng" };
  const rig = await workbench(
    {
      partial: [
        typed("capabilities"),
        typed("inspect", { source }),
        typed("file_metadata", { source }),
        deriveFile("convert", { source, outputFormat: "pcap" }),
        { text: "Done." },
      ],
    },
    "tshark_only",
  );
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    const service = await rig.start();
    const turn = rig.session(service, "partial", "ask");
    service.send(turn.id, "Check which saved capture operations are ready.");
    await service.waitIdle(turn.id);
    const out = turn.outputs.map(({ summary }) => JSON.parse(summary));
    expect(out[0]).toMatchObject({
      tshark: { available: true },
      fileOperations: {
        metadata: { available: false, missing: ["capinfos"] },
        convert: { available: false, missing: ["editcap"] },
        exportFields: { available: true },
      },
    });
    expect(out[1]).toMatchObject({ coverage: { scannedThrough: 8 } });
    expect(out[2]).toMatchObject({
      reason: "utility_unavailable",
      error: expect.stringContaining("capinfos"),
    });
    expect(out[3]).toMatchObject({
      reason: "utility_unavailable",
      error: expect.stringContaining("editcap"),
    });
  } finally {
    await rig.close();
  }
}, 90_000);

it("projects native offline networking profiles, source references, and redacted evidence", async (ctx) => {
  const source = { path: "captures/networking.pcapng" };
  const compactSource = { path: "captures/private-capture.pcapng" };
  const nameFilter = 'dns.qry.name == "private.test"';
  const network = (profile: string, options: Record<string, unknown> = {}) =>
    typed("network", { source, networkProfile: profile, ...options });
  const exchanges = { networkQuery: { kind: "exchanges" } };
  const rig = await workbench({
    networking: [
      typed("capabilities"),
      network("ethernet_vlan", { limit: 1 }),
      network("ipv4_ipv6", { filter: "frame.number in {3, 5, 20}" }),
      network("arp_nd", exchanges),
      network("dns_dhcp", exchanges),
      network("dns_dhcp", { ...exchanges, filter: "frame.number == 6" }),
      network("dns_dhcp", { ...exchanges, scanFrames: 5 }),
      network("tcp_udp", { networkQuery: { kind: "conversations", transport: "udp" }, filter: "dns" }),
      network("tcp_udp", { networkQuery: { kind: "conversations", transport: "tcp" }, filter: "tls" }),
      network("tcp_udp", {
        source: { path: "captures/traffic.pcapng" },
        networkQuery: { kind: "tcp_symptoms" },
        validateChecksums: true,
      }),
      network("multicast", { networkQuery: { kind: "multicast" } }),
      network("tls", { evidenceMode: "compact", filter: "frame.number in {14, 15, 19}" }),
      network("dns_dhcp", {
        ...exchanges,
        source: compactSource,
        evidenceMode: "compact",
        filter: nameFilter,
      }),
      network("tls", { source: { path: "captures/secrets.pcapng" } }),
      network("tcp_udp", {
        networkQuery: { kind: "conversations", transport: "tcp" },
        filter: "frame.number == 21",
      }),
      network("tcp_udp", {
        networkQuery: { kind: "conversations", transport: "udp" },
        filter: "frame.number == 20",
      }),
      network("tls", { filter: "frame.number == 23" }),
      network("tls", { filter: "frame.number == 25" }),
      network("ethernet_vlan", { source: { path: "captures/cooked.pcap" } }),
      network("dns_dhcp", { ...exchanges, filter: "frame.number == 28" }),
      network("dns_dhcp", { ...exchanges, filter: "frame.number == 30" }),
      network("tcp_udp", {
        networkQuery: { kind: "conversations", transport: "udp" },
        filter: "frame.number == 30",
      }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    const fixture = await readFile(networkingSample);
    await writeFile(join(rig.bench, source.path), fixture);
    await writeFile(join(rig.bench, compactSource.path), fixture);
    await writeFile(join(rig.bench, "captures/traffic.pcapng"), await readFile(trafficSample));
    await writeFile(
      join(rig.bench, "captures/cooked.pcap"),
      await readFile(new URL("../fixtures/wireshark-tshark/networking-cooked.pcap", import.meta.url)),
    );
    await writeFile(
      join(rig.bench, "captures/secrets.pcapng"),
      Buffer.concat([fixture, Buffer.from("0a000000140000004b534c540000000014000000", "hex")]),
    );
    rig.resultBudget(32_000, (text) =>
      text
        .replaceAll("private.test", "[masked]")
        .replaceAll("0x4321", "[masked ID]")
        .replaceAll("private-capture.pcapng", "[masked capture]"),
    );
    const service = await rig.start();
    const session = rig.session(service, "networking", "ask");
    service.send(session.id, "Analyze the controlled saved networking capture.");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const output = session.outputs.map(({ summary }) => JSON.parse(summary));
    expect(
      session.outputs.map(({ ok }) => ok),
      session.outputs
        .filter(({ ok }) => !ok)
        .map(({ summary }) => summary)
        .join("\n"),
    ).toEqual([...Array<boolean>(13).fill(true), false, ...Array<boolean>(8).fill(true)]);
    const [
      capabilities,
      eth,
      ip,
      arp,
      dns,
      filtered,
      prefix,
      udp,
      tcp,
      symptoms,
      multicast,
      tls,
      compact,
      secret,
      tunneled,
      fragmented,
      mixedTls,
      sameTls,
      cooked,
      mixedDns,
      mixedDhcp,
      mixedUdp,
    ] = output;
    expect(capabilities.networking.profiles).toEqual([
      "ethernet_vlan",
      "ipv4_ipv6",
      "arp_nd",
      "dns_dhcp",
      "tcp_udp",
      "multicast",
      "tls",
    ]);
    expect(eth.networking.rows[0]).toMatchObject({ frames: [1], fields: { "vlan.id": ["42"] } });
    expect(eth.networking.scopeCoverage).toMatchObject({ knownDrops: "3", dropReports: 1 });
    expect(ip.networking.rows).toMatchObject([
      { frames: [3], source: { address: "2001:db8::1" }, destination: { address: "ff02::1:ff00:2" } },
      { frames: [5], source: { address: "192.168.7.1" }, destination: { address: "192.168.7.10" } },
      { frames: [20], fields: { "ip.flags.mf": ["True"] } },
    ]);
    expect(ip.networking.scopeCoverage.reassemblyLimits).toMatchObject({ pendingOrInvalidFrames: 1 });
    expect(arp.networking.rows).toMatchObject([
      {
        frames: [1],
        protocol: "arp",
        exchange: { phase: "request" },
        fields: { "arp.dst.proto_ipv4": ["192.168.7.10"] },
      },
      {
        frames: [2],
        protocol: "arp",
        exchange: { phase: "response" },
        fields: { "arp.src.proto_ipv4": ["192.168.7.10"] },
      },
      {
        frames: [3],
        protocol: "nd",
        exchange: { phase: "neighbor_solicitation" },
        fields: { "icmpv6.nd.ns.target_address": ["2001:db8::2"] },
      },
      {
        frames: [4],
        protocol: "nd",
        exchange: { phase: "neighbor_advertisement" },
        fields: { "icmpv6.nd.na.target_address": ["2001:db8::2"] },
      },
    ]);
    expect(dns.analysis).toMatchObject({ tool: "tshark", networkProfile: "dns_dhcp" });
    expect(dns.capture.sha256).toBe(createHash("sha256").update(fixture).digest("hex"));
    expect(dns.networking.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          frames: [5, 6],
          protocol: "dns",
          fields: expect.objectContaining({ "dns.id": ["[masked ID]"] }),
          exchange: expect.objectContaining({ transactionId: null }),
        }),
        expect.objectContaining({
          frames: [8],
          protocol: "dhcp",
          exchange: { phase: "server_message", messageType: 2, transactionId: "0x12345678" },
          fields: expect.objectContaining({ "dhcp.id": ["0x12345678"], "dhcp.ip.your": ["192.168.7.1"] }),
        }),
        expect.objectContaining({
          frames: [10],
          protocol: "dhcpv6",
          exchange: { phase: "server_message", messageType: 2, transactionId: "0x123456" },
          fields: expect.objectContaining({ "dhcpv6.xid": ["0x123456"] }),
        }),
        expect.objectContaining({
          frames: [17],
          vlans: [42],
          dnsRelationship: { status: "ambiguous_context" },
        }),
        expect.objectContaining({
          frames: [18],
          vlans: [43],
          dnsRelationship: { status: "ambiguous_context" },
        }),
      ]),
    );
    expect(filtered.networking.rows).toMatchObject([
      {
        frames: [5, 6],
        observationFrame: 6,
        dnsRelationship: { status: "native_link", counterpartInScope: false },
      },
    ]);
    expect(
      filtered.networking.evidence.map(({ frame }: { frame: { number: number } }) => frame.number),
    ).toEqual([5, 6]);
    expect(filtered.networking.evidence[0].ref).toMatch(/^capture:/);
    expect(filtered.networking.scopeCoverage).toMatchObject({
      truncatedFrames: 0,
      scannedTruncatedFrames: 1,
    });
    expect(prefix.coverage).toMatchObject({ scanComplete: false, partial: true, scannedThrough: 5 });
    expect(prefix.networking.rows).toMatchObject([
      { frames: [5], dnsRelationship: { status: "counterpart_not_observed" } },
    ]);
    expect(udp.networking.rows[0]).toMatchObject({
      frames: [5, 6],
      protocol: "udp",
      aToB: { packets: 1 },
      bToA: { packets: 1 },
    });
    expect(tcp.networking.rows[0]).toMatchObject({
      frames: [14, 15],
      protocol: "tcp",
      aToB: { packets: 1 },
      bToA: { packets: 1 },
    });
    expect(symptoms.networking.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ frames: [5], symptoms: ["retransmission"] }),
        expect.objectContaining({ frames: [7], symptoms: ["previousSegmentUnseen"] }),
        expect.objectContaining({
          frames: [10],
          fields: expect.objectContaining({ "tcp.checksum.partial": ["1"] }),
        }),
      ]),
    );
    expect(symptoms.networking.scopeCoverage).toMatchObject({
      interpretation: "observed_at_saved_capture_interfaces",
      knownDrops: null,
      truncatedFrames: 1,
    });
    expect(multicast.networking.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          frames: [11],
          protocol: "igmp",
          fields: expect.objectContaining({ "igmp.maddr": ["239.1.2.3"] }),
        }),
        expect.objectContaining({ frames: [12], protocol: "mld" }),
        expect.objectContaining({ frames: [13], protocol: "multicast" }),
      ]),
    );
    expect(multicast.networking.rows.some(({ frames }: { frames: number[] }) => frames.includes(7))).toBe(
      false,
    );
    expect(tls.networking.rows).toMatchObject([
      {
        frames: [14],
        redactedFields: ["tls.handshake.extensions_server_name"],
        source: { address: null, redacted: true },
      },
      { frames: [15], fields: { "tls.record.content_type": ["23"] }, opaqueTls: true },
      { frames: [19], protocol: "tls_candidate" },
    ]);
    expect(tls.networking.scopeCoverage.reassemblyLimits).toMatchObject({ tlsCandidateFrames: 1 });
    expect(JSON.stringify(tls)).not.toMatch(/tls-private\.test|LOCAL_TLS_OPAQUE|192\.168\.7\./);
    expect(JSON.stringify(compact.networking)).not.toMatch(/private\.test|192\.168\.7\./);
    expect(compact.networking.rows[0].redactedFields).toContain("dns.qry.name");
    expect(secret.reason).toBe("network_embedded_secrets");
    for (const item of [tunneled, fragmented]) {
      expect(item.coverage).toMatchObject({ matchedInScope: 1, returned: 0, partial: true });
      expect(item.networking.scopeCoverage).toMatchObject({ unresolvedEndpointFrames: 1 });
    }
    expect(fragmented.networking.scopeCoverage.reassemblyLimits).toMatchObject({ pendingOrInvalidFrames: 1 });
    expect(mixedTls.networking.rows).toMatchObject([
      { frames: [23], reassembly: { unverifiedFrames: 1, pendingOrInvalid: true } },
    ]);
    expect(mixedTls.networking.rows[0].fields).not.toHaveProperty(["tls.handshake.extensions_server_name"]);
    expect(mixedTls.coverage.partial).toBe(true);
    expect(sameTls.networking.rows).toMatchObject([
      {
        frames: [24, 25],
        reassembly: { outsideScopeFrames: 1, unverifiedFrames: 0, pendingOrInvalid: false },
      },
    ]);
    expect(
      sameTls.networking.evidence.map(({ frame }: { frame: { number: number } }) => frame.number),
    ).toEqual([24, 25]);
    expect(cooked.networking.rows).toMatchObject([
      { frames: [1], protocol: "vlan", fields: { "vlan.id": ["42"] }, source: null, destination: null },
    ]);
    expect(mixedDns.networking.rows).toMatchObject([
      { frames: [28], dnsRelationship: { status: "ambiguous_context" } },
    ]);
    expect(mixedDns.networking.scopeCoverage.unresolvedDnsFrames).toBe(1);
    expect(mixedDhcp.networking.rows).toMatchObject([
      {
        frames: [30],
        protocol: "dhcp",
        exchange: null,
        source: null,
        destination: null,
        reassembly: {
          pendingOrInvalid: true,
          transportContextUnverified: true,
          withheldFields: expect.arrayContaining(["dhcp.ip.your"]),
        },
      },
    ]);
    expect(mixedDhcp.networking.rows[0].fields).not.toHaveProperty(["dhcp.ip.your"]);
    expect(mixedUdp.coverage).toMatchObject({ matchedInScope: 1, returned: 0, partial: true });
    expect(mixedUdp.networking.scopeCoverage.unresolvedEndpointFrames).toBe(1);
    expect(rig.modelResults).toEqual(expect.arrayContaining([expect.stringContaining("[masked]")]));
    expect(rig.modelResults.every((result) => !result.includes("private.test"))).toBe(true);
    expect(rig.modelResults.every((result) => !result.includes("0x4321"))).toBe(true);
    expect(rig.modelResults.every((result) => !result.includes("private-capture.pcapng"))).toBe(true);
    const compactModel = rig.modelResults
      .map((result) => JSON.parse(result))
      .find(
        (result) =>
          result.analysis?.networkProfile === "dns_dhcp" && result.networking?.evidenceMode === "compact",
      );
    expect(compactModel).toMatchObject({
      capture: { source: { path: "[redacted]" } },
      analysis: { filter: "[redacted]" },
      networking: { redactedContext: expect.arrayContaining(["capture.source.path", "analysis.filter"]) },
    });

    await rig.writeReplay("network-next", [
      network("ethernet_vlan", { limit: 1, networkCursor: eth.networking.page.next }),
      network("ethernet_vlan", { limit: 1, networkCursor: eth.networking.page.next, filter: "vlan" }),
      { text: "Done." },
    ]);
    const next = rig.session(service, "network-next", "ask");
    service.send(next.id, "Continue the original network page.");
    await service.waitIdle(next.id);
    expect(JSON.parse(next.outputs[0]?.summary ?? "{}").networking.rows[0].frames).toEqual([2]);
    expect(JSON.parse(next.outputs[1]?.summary ?? "{}").reason).toBe("cursor_mismatch");

    const reference = compact.networking.evidence[0].ref;
    await rig.writeReplay("network-citation", [
      network("dns_dhcp", {
        ...exchanges,
        source: compactSource,
        filter: nameFilter,
        evidenceMode: "compact",
      }),
      { text: `The request was captured earlier. [[${reference}]]` },
    ]);
    const citation = rig.session(service, "network-citation", "ask");
    service.send(citation.id, "Cite the corresponding DNS request frame.");
    await service.waitIdle(citation.id);
    const assistant = service
      .get(citation.id)
      .snapshot.items.find(
        (item) =>
          item.kind === "assistant" && item.citations.some(({ ref, valid }) => ref === reference && valid),
      );
    expect(assistant).toBeDefined();
    expect(service.openCaptureCitation(citation.id, assistant?.id ?? "", reference).evidence).toMatchObject({
      capture: { sha256: dns.capture.sha256, source: { kind: "workbench", path: compactSource.path } },
      analysis: { networkProfile: "dns_dhcp", filter: nameFilter },
      frame: { number: 5, interfaceId: 0 },
    });
    const db = rig.database();
    expect(
      db
        .prepare(
          "SELECT count(*) FROM tool_calls WHERE session_id=? AND json_type(result_json,'$.networkCaptureContext')='object'",
        )
        .pluck()
        .get(citation.id),
    ).toBe(1);
    expect(
      db
        .prepare("SELECT content_json FROM messages WHERE session_id=? AND role='toolResult'")
        .pluck()
        .all(citation.id),
    ).toEqual([expect.not.stringMatching(/networkCaptureContext|private-capture\.pcapng|private\.test/)]);
    if (evidence) {
      await writeFile(
        join(evidence, `${process.platform}-networking.json`),
        JSON.stringify(
          {
            nativeVersion: rig.tshark.version,
            output,
            next: next.outputs.map(({ summary }) => JSON.parse(summary)),
            citation: service.openCaptureCitation(citation.id, assistant?.id ?? "", reference).evidence,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await rig.close();
  }
}, 60_000);

it("projects offline Automotive Ethernet PDUs, transport context, and coverage", async (ctx) => {
  const source = { path: "captures/automotive.pcapng" };
  const coverageSource = { path: "captures/automotive-coverage.pcapng" };
  const mixedSource = { path: "captures/automotive-mixed-vlan.pcapng" };
  const someip = { transport: "udp", port: 30501, protocol: "someip" };
  const rig = await workbench({
    automotive: [
      typed("automotive", { source, automotiveProfile: "doip" }),
      typed("automotive", { source, automotiveProfile: "someip", decodeAs: [someip] }),
      typed("automotive", { source, automotiveProfile: "someip_sd" }),
      typed("automotive", {
        source,
        automotiveProfile: "doip",
        vlan: 7,
        addresses: ["192.168.7.10"],
        ports: [13400],
        expectedPoints: [
          { section: 1, interfaceId: 1 },
          { section: 1, interfaceId: 7 },
        ],
      }),
      typed("automotive", { source, automotiveProfile: "doip", scanFrames: 1 }),
      typed("automotive", { source, automotiveProfile: "doip", decodeAs: [someip] }),
      typed("automotive", { source, automotiveProfile: "doip", limit: 1 }),
      typed("automotive", {
        source: coverageSource,
        automotiveProfile: "doip",
        addresses: ["192.168.7.10"],
        ports: [13400],
      }),
      typed("automotive", { source: mixedSource, automotiveProfile: "doip" }),
      typed("automotive", { source: mixedSource, automotiveProfile: "doip", vlan: 42 }),
      typed("automotive", { source: mixedSource, automotiveProfile: "someip", vlan: 42, decodeAs: [someip] }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    await writeFile(join(rig.bench, source.path), await readFile(automotiveSample));
    await writeFile(join(rig.bench, coverageSource.path), await readFile(automotiveCoverageSample));
    await writeFile(join(rig.bench, mixedSource.path), await readFile(automotiveMixedVlanSample));
    rig.resultBudget(32_000, (text) => text.replaceAll("192.168.7.10", "[masked]"));
    const service = await rig.start();
    const session = rig.session(service, "automotive", "bypass");
    service.send(session.id, "Analyze saved Automotive Ethernet evidence.");
    await service.waitIdle(session.id);
    expect(
      session.outputs.map(({ ok }) => ok),
      session.outputs
        .filter(({ ok }) => !ok)
        .map(({ summary }) => summary)
        .join("\n"),
    ).toEqual([true, true, true, true, true, false, true, true, true, true, true]);
    const [doip, tp, sd, vlan, prefix, invalid, page, tail, mixed, scopedMixed, scopedMixedTp] =
      session.outputs.map(({ summary }) => JSON.parse(summary));
    expect(mixed.automotive.rows).toMatchObject([
      { frames: [1, 2], pdu: { reassembly: { observationContext: "mixed" } } },
    ]);
    expect(scopedMixed.coverage).toMatchObject({
      scanComplete: true,
      partial: true,
      matchedInScope: 1,
      returned: 0,
    });
    expect(scopedMixed.automotive.scopeCoverage).toMatchObject({
      undecodedPayloadFrames: 1,
      issueFrames: { undecodedPayload: 1 },
    });
    expect(scopedMixedTp.coverage).toMatchObject({
      scanComplete: true,
      partial: true,
      matchedInScope: 1,
      returned: 1,
    });
    expect(scopedMixedTp.automotive.rows).toMatchObject([
      {
        frames: [3, 4],
        pdu: { reassembly: { someipTp: "fragment", completedIn: 4, observationContext: "mixed" } },
      },
    ]);
    expect(scopedMixedTp.automotive.scopeCoverage).toMatchObject({
      unverifiedReassemblyContextPdus: 1,
      issueFrames: { unverifiedReassemblyContext: 3 },
    });
    expect(tail.coverage).toMatchObject({
      scanComplete: true,
      partial: true,
      matchedInScope: 2,
      returned: 1,
    });
    expect(tail.automotive.scopeCoverage).toMatchObject({
      undecodedPayloadFrames: 1,
      unresolvedTransportFrames: 1,
      issueFrames: { undecodedPayload: 1, unresolvedTransport: 2 },
    });
    expect(tail.automotive.rows).toMatchObject([{ frames: [1], pdu: { fields: { "doip.type": 7 } } }]);
    expect(doip.analysis).toMatchObject({ tool: "tshark", automotiveProfile: "doip" });
    expect(doip.automotive.rows).toMatchObject([
      { frames: [1, 2], pdu: { occurrence: 1, fields: { "doip.type": 0x8001 }, payloadBytes: 15 } },
      { frames: [2], pdu: { occurrence: 2, fields: { "doip.type": 7 } } },
      { frames: [3], pdu: { occurrence: 1, fields: { "doip.diag_ack_code": 0 } } },
      { frames: [3], pdu: { occurrence: 2, fields: { "doip.diag_nack_code": 3 } } },
      { frames: [4], pdu: { occurrence: 1, fields: { "doip.type": 1 } } },
    ]);
    expect(
      doip.automotive.evidence.find(({ frame }: { frame: { number: number } }) => frame.number === 1),
    ).toMatchObject({
      frame: { interfaceId: 0, timestampEpoch: "1767225600.000000000" },
      direction: "inbound",
    });
    expect(doip.automotive.conversations[0]).toMatchObject({
      transport: "tcp",
      forward: { pdus: 2 },
      reverse: { pdus: 2 },
    });
    expect(doip.automotive.scopeCoverage).toMatchObject({
      unsupportedEncapsulationFrames: 1,
      truncatedFrames: 1,
      knownDrops: "2",
      framesWithoutTimestamp: 1,
      undecodedPayloadFrames: 2,
      issueFrames: { undecodedPayload: 5, truncated: 10, unsupportedEncapsulation: 11 },
    });
    expect(doip.coverage.partial).toBe(true);
    expect(tp.automotive.rows).toMatchObject([
      {
        frames: [6, 7],
        pdu: { reassembly: { someipTp: "fragment", completedIn: 7, observationContext: "same" } },
      },
      {
        frames: [6, 7],
        pdu: {
          reassembly: { someipTp: "reassembled", completedIn: 7 },
          payloadBytes: 20,
          fields: {
            "someip.serviceid": 0x1234,
            "someip.methodid": 2,
            "someip.clientid": 9,
            "someip.sessionid": 5,
            "someip.protoversion": 1,
            "someip.interfaceversion": 2,
          },
        },
      },
      { frames: [8], pdu: { reassembly: { someipTp: "fragment", completedIn: null } } },
    ]);
    expect(tp.automotive.scopeCoverage.unfinishedTpFragments).toBe(1);
    expect(sd.analysis.decodeAs).toMatchObject([{ transport: "udp", port: 30490, protocol: "someip" }]);
    expect(sd.automotive.rows).toMatchObject([
      {
        frames: [9],
        pdu: {
          entries: [
            { "someipsd.entry.serviceid": 0x1234, "someipsd.entry.ttl": 5 },
            { "someipsd.entry.serviceid": 0x1235, "someipsd.entry.ttl": 0 },
          ],
        },
      },
    ]);
    expect(vlan.automotive.rows).toMatchObject([{ frames: [4] }]);
    expect(vlan.automotive.evidence).toMatchObject([
      { frame: { number: 4, interfaceId: 1 }, vlans: [7, 42] },
    ]);
    expect(vlan.automotive.scopeCoverage.missingExpectedPoints).toEqual([{ section: 1, interfaceId: 7 }]);
    expect(prefix.coverage).toMatchObject({ scannedThrough: 1, scanComplete: false, partial: true });
    expect(prefix.automotive.scopeCoverage.undecodedPayloadFrames).toBe(1);
    expect(invalid.reason).toBe("invalid_decode_as");
    expect(page.automotive.page.next).toMatchObject({ offset: 1 });
    expect(page.coverage.partial).toBe(true);
    const modelPage = rig.modelResults
      .map((result) => JSON.parse(result))
      .find(({ automotive }) => automotive?.selection.vlan === 7);
    expect(modelPage.automotive.selection.addresses).toEqual(["[masked]"]);
    expect(modelPage.automotive.conversations[0].b.address).toBe("[masked]");
    expect(JSON.stringify(session.outputs)).not.toContain("VERA_DOIP_LOCAL");
    expect(
      rig.starts.filter((options) => options.includes("-r")).every((options) => options.includes("-n")),
    ).toBe(true);
    const cursor = page.automotive.page.next;
    const ref = page.automotive.rows[0].pdu.ref;
    await rig.writeReplay("next", [
      typed("automotive", { source, automotiveProfile: "doip", limit: 1, automotiveCursor: cursor }),
      typed("automotive", { source, automotiveProfile: "doip", limit: 1, vlan: 7, automotiveCursor: cursor }),
      { text: `The next PDU is in the same source frame [[${ref}]].` },
    ]);
    const next = rig.session(service, "next", "bypass");
    service.send(next.id, "Continue the page and cite the packet.");
    await service.waitIdle(next.id);
    const [continued, stale] = next.outputs.map(({ summary }) => JSON.parse(summary));
    expect(continued.automotive.rows).toMatchObject([{ frames: [2], pdu: { occurrence: 2, ref } }]);
    expect(stale.reason).toBe("cursor_mismatch");
    const assistant = service.get(next.id).snapshot.items.findLast((item) => item.kind === "assistant");
    expect(assistant).toMatchObject({ citations: [{ ref, valid: true }] });
    expect(service.openCaptureCitation(next.id, assistant?.id ?? "", ref).evidence).toMatchObject({
      frame: { number: 2, captureSha256: page.capture.sha256 },
      analysis: { automotiveProfile: "doip" },
    });
  } finally {
    await rig.close();
  }
}, 90_000);

it("reconciles offline Automotive Ethernet with the upstream SOME/IP samples", async (ctx) => {
  const folder = process.env.VERA_WIRESHARK_AUTOMOTIVE_SAMPLES;
  if (!folder) {
    ctx.skip("Set VERA_WIRESHARK_AUTOMOTIVE_SAMPLES to the upstream sample directory.");
    return;
  }
  const samples = [
    { name: "someip_sd_sample.pcap", profile: "someip_sd" },
    { name: "someip-udp-method-call.pcapng", profile: "someip", port: 49201 },
    { name: "someip-tp.pcap", profile: "someip", port: 18193 },
  ];
  const rig = await workbench({
    upstream: [
      ...samples.map(({ name, profile, port }) =>
        typed("automotive", {
          source: { path: `captures/${name}` },
          automotiveProfile: profile,
          ...(port ? { decodeAs: [{ transport: "udp", port, protocol: "someip" }] } : {}),
        }),
      ),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) throw Error("Native TShark is required for upstream sample reconciliation.");
    for (const { name } of samples)
      await writeFile(join(rig.bench, "captures", name), await readFile(join(folder, name)));
    const service = await rig.start();
    const session = rig.session(service, "upstream", "bypass");
    service.send(session.id, "Reconcile the published SOME/IP protocol samples.");
    await service.waitIdle(session.id);
    expect(
      session.outputs.map(({ ok }) => ok),
      JSON.stringify(session.outputs),
    ).toEqual([true, true, true]);
    const [sd, method, tp] = session.outputs.map(({ summary }) => JSON.parse(summary).automotive);
    expect(sd.rows).toHaveLength(6);
    expect(sd.rows[0]).toMatchObject({
      frames: [1],
      pdu: { entries: [{ "someipsd.entry.type": 1, "someipsd.entry.ttl": 30 }] },
    });
    expect(sd.evidence[0]).toMatchObject({ encapsulation: 97, frame: { interfaceId: null, number: 1 } });
    expect(method.rows).toMatchObject([
      {
        frames: [2],
        pdu: { fields: { "someip.serviceid": 0x1234, "someip.methodid": 8, "someip.messagetype": 0 } },
      },
      {
        frames: [3],
        pdu: { fields: { "someip.serviceid": 0x1234, "someip.methodid": 8, "someip.messagetype": 0x80 } },
      },
    ]);
    expect(tp.rows).toHaveLength(9);
    expect(tp.rows.at(-1)).toMatchObject({
      frames: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      pdu: { payloadBytes: 12292, reassembly: { someipTp: "reassembled", completedIn: 9 } },
    });
  } finally {
    await rig.close();
  }
}, 90_000);
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("plugin.yaml", source), "utf8"));
const hint =
  "Install Wireshark (Windows: includes TShark and offers Npcap) from https://www.wireshark.org/download.html, or your distribution's tshark package.";

it("publishes the official find-only tshark package, its pack and two skills", async () => {
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m).toMatchObject({
    id: "wireshark-tshark",
    ecosystem: "wireshark",
    platforms: ["windows-x64", "linux-x64"],
  });
  expect(m.programs.tshark?.install).toEqual({
    find: { windows: ["%PATH%", "%ProgramFiles%/Wireshark/tshark.exe"], linux: ["$PATH", "/usr/bin/tshark"] },
    hint,
  });
  expect(m.programs.tshark?.version).toEqual({
    args: ["--version"],
    match: "^TShark \\(Wireshark\\) (\\d+\\.\\d+\\.\\d+)",
  });
  expect(m.programs.tshark?.optionSyntax).toBe("tshark");
  expect(m.programs.text2pcap?.install).toMatchObject({
    find: {
      windows: ["%PATH%", "%ProgramFiles%/Wireshark/text2pcap.exe"],
      linux: ["$PATH", "/usr/bin/text2pcap"],
    },
  });
  expect(classifyCommand(m.rules, "text2pcap", ["input.hex", "output.pcapng"]).risk).toBe("device-read");
  expect(classifyCommand(m.rules, "editcap", ["-r", "big.pcapng", "part.pcapng", "1-100"]).risk).toBe(
    "device-read",
  );
  expect(classifyCommand(m.rules, "mergecap", ["-w", "all.pcapng", "a.pcapng", "b.pcapng"]).risk).toBe(
    "device-read",
  );
  expect(classifyCommand(m.rules, "capinfos", ["-c", "big.pcapng"]).risk).toBe("safe");
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("wireshark-tshark");
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs).toContainEqual({
    id: "wireshark",
    name: "Wireshark",
    groups: [
      { name: "Capture analysis", plugins: ["wireshark-tshark"], default: true },
      { name: "Local capture", plugins: ["wireshark-dumpcap"], default: false },
    ],
  });
});

it("classifies parsed tshark option roles at the highest risk", async () => {
  const m = await manifest();
  const classify = (args: string[]) =>
    classifyCommand(m.rules, "tshark", args, m.programs.tshark?.optionSyntax);
  const cases = [
    // Information-only commands exit before any capture.
    ["safe", ["--version"]],
    ["safe", ["-v"]],
    ["safe", ["-nv"]],
    ["safe", ["-h"]],
    ["safe", ["--help"]],
    ["safe", ["--vers"]],
    ["safe", ["-D"]],
    ["safe", ["-nD"]],
    ["safe", ["--list-interfaces"]],
    ["safe", ["--list-i"]],
    ["safe", ["--list-sources"]],
    ["safe", ["-G", "protocols"]],
    ["safe", ["-G"]],
    ["safe", ["-n", "-G", "protocols"]],
    ["safe", ["-nGfields"]],
    // Reading a capture file, with every output and processing option.
    ["safe", ["-r", "cap.pcapng"]],
    ["safe", ["-rcap.pcapng"]],
    ["safe", ["--read-file", "cap.pcapng"]],
    ["safe", ["--read-file=cap.pcapng"]],
    ["safe", ["-nr", "cap.pcapng", "-Y", "coap"]],
    ["safe", ["-r", "cap.pcapng", "-T", "fields", "-e", "frame.number", "-E", "header=y"]],
    ["safe", ["-r", "cap.pcapng", "-q", "-z", "io,phs"]],
    ["safe", ["-r", "cap.pcapng", "-x", "-V", "-O", "coap"]],
    ["safe", ["-r", "cap.pcapng", "--hexdump", "frames"]],
    ["safe", ["-r", "cap.pcapng", "-2", "-R", "udp", "-w", "-"]],
    ["safe", ["-r", "cap.pcapng", "-w-"]],
    ["safe", ["-r", "cap.pcapng", "-W", "n", "-U", "tap"]],
    ["safe", ["-r", "cap.pcapng", "-o", "tcp.check_checksum:TRUE", "-d", "udp.port==5684,coap"]],
    ["safe", ["-r", "cap.pcapng", "-X", "read_format:pcapng"]],
    ["safe", ["-r", "cap.pcapng", "--selected-frame", "3", "--print-timers"]],
    ["safe", ["-r", "cap.pcapng", "-Y", "-i"]],
    ["safe", ["-r", "cap.pcapng", "-e", "-I"]],
    ["safe", ["-r", "cap.pcapng", "coap"]],
    ["safe", ["-r", "cap.pcapng", "--", "-v"]],
    // Reading a capture file while writing a file or folder.
    ["device-read", ["-r", "cap.pcapng", "-2", "-R", "udp", "-w", "udp.pcapng"]],
    ["device-read", ["-r", "cap.pcapng", "-wudp.pcapng"]],
    ["device-read", ["-nw", "/tmp/udp.pcapng", "-r", "cap.pcapng"]],
    ["device-read", ["-r", "cap.pcapng", "--export-objects", "http,objects"]],
    ["device-read", ["-r", "cap.pcapng", "--export-o=http,objects"]],
    ["device-read", ["-r", "cap.pcapng", "--export-tls-session-keys", "keys.log"]],
    ["device-read", ["-r", "cap.pcapng", "--log-file=tshark.log"]],
    ["device-read", ["-r", "cap.pcapng", "coap", "-w", "udp.pcapng"]],
    ["device-read", ["-r", "cap.pcapng", "--", "--export-objects", "http,objects"]],
    ["device-read", ["-v", "-w", "udp.pcapng"]],
    // Live capture: an interface option, a link or timestamp type query, or no capture file at all.
    ["device-read", ["-i", "eth0"]],
    ["device-read", ["-ieth0"]],
    ["device-read", ["--interface", "eth0", "-c", "10"]],
    ["device-read", ["--interface=1", "-a", "duration:5", "-w", "live.pcapng"]],
    ["device-read", ["--inter=eth0"]],
    ["device-read", ["--source", "eth0"]],
    ["device-read", ["-ni", "eth0"]],
    ["device-read", ["-pI", "-i", "wlan0"]],
    ["device-read", ["-L", "-i", "eth0"]],
    ["device-read", ["--list-data-link-types"]],
    ["device-read", ["--list-time-stamp-types"]],
    ["device-read", ["--monitor-mode"]],
    ["device-read", ["-r", "cap.pcapng", "-i", "eth0"]],
    ["device-read", ["-c", "5"]],
    ["device-read", ["-Y", "coap"]],
    ["device-read", ["-n"]],
    ["device-read", []],
    ["device-read", ["udp", "port", "5683"]],
    ["device-read", ["foo", "-v"]],
    ["device-read", ["foo", "-r", "cap.pcapng"]],
    ["device-read", ["--", "-r", "cap.pcapng"]],
    ["device-read", ["-v", "-i", "eth0"]],
    ["device-read", ["-G", "protocols", "-i", "eth0"]],
    ["device-read", ["-r", "cap.pcapng", "coap", "-i", "eth0"]],
    ["device-read", ["-r", "cap.pcapng", "--", "--source=eth0"]],
    // Unrecognised or ambiguous options.
    ["device-write", ["-r", "cap.pcapng", "--log", "x"]],
    ["device-write", ["--read=cap.pcapng"]],
    ["device-write", ["-r", "cap.pcapng", "--no-such-option"]],
    ["device-write", ["-r", "cap.pcapng", "-k"]],
    ["device-write", ["-r", "cap.pcapng", "-Z", "user"]],
    // Lua scripts and command-line RPCAP credentials.
    ["device-write", ["-r", "cap.pcapng", "-X", "lua_script:dissector.lua"]],
    ["device-write", ["-r", "cap.pcapng", "-Xlua_script:dissector.lua"]],
    ["device-write", ["-r", "cap.pcapng", "-X", "lua_script1:argument"]],
    ["device-write", ["-r", "cap.pcapng", "-Xlua_script1:argument"]],
    ["device-write", ["-nXlua_script1:argument", "-r", "cap.pcapng"]],
    ["device-write", ["-r", "cap.pcapng", "-X", "LUA_SCRIPT:dissector.lua"]],
    ["device-write", ["-nX", "lua_script:dissector.lua", "-r", "cap.pcapng"]],
    ["device-write", ["-v", "-X", "lua_script:dissector.lua"]],
    ["device-write", ["-G", "-X", "lua_script:dissector.lua"]],
    ["device-write", ["-r", "cap.pcapng", "coap", "-X", "lua_script:dissector.lua"]],
    ["device-write", ["-r", "cap.pcapng", "--", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-i", "rpcap://host/eth0", "-A", "user:secret"]],
    ["blocked", ["-Auser:secret", "-i", "rpcap://host/eth0"]],
    ["blocked", ["-r", "cap.pcapng", "coap", "-A", "user:secret"]],
  ] as const;
  for (const [risk, args] of cases) expect(classify([...args]).risk, args.join(" ")).toBe(risk);
  expect(classify(["-i", "eth0"]).notes.join(" ")).toContain("Npcap");
  const writes = m.rules.find((rule) => rule.match.includes("<write>"))?.note;
  expect(writes).toContain("--export-objects");
  expect(classify(["-r", "cap.pcapng", "-w", "udp.pcapng"]).notes).toContain(writes);
  expect(classify(["-i", "eth0", "-w", "live.pcapng"]).notes).toContain(writes);
  expect(classify(["-r", "cap.pcapng", "-Y", "-w"]).notes).not.toContain(writes);
  expect(classify(["-r", "cap.pcapng", "-X", "lua_script:x.lua"]).notes.join(" ")).toContain("Lua");
});

const windows = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
const version = "TShark (Wireshark) 4.6.8 (v4.6.8-0-ge677bf052328).\n";

it("finds tshark on PATH or in the Wireshark folder and shows the hint when it is missing", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-tshark-find-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(fileURLToPath(source));
    const plugin = await store.load("wireshark-tshark");
    const onPath = join(root, "bin");
    const programFiles = join(root, "Program Files");
    await mkdir(onPath);
    await mkdir(join(programFiles, "Wireshark"), { recursive: true });
    const spawned: string[] = [];
    const provisioner = (system: "win32" | "linux", env: Record<string, string>) =>
      new core.Provisioner({
        store,
        root: join(root, "runtime"),
        platform: system === "win32" ? "windows-x64" : "linux-x64",
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("tshark must never download");
        },
        host: {
          platform: system,
          env,
          spawn(executable, _args, options) {
            spawned.push(executable);
            options.output("stdout", Buffer.from(version));
            return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
          },
          signal: () => true,
        },
      });
    const missing = provisioner("win32", { PATH: join(root, "empty"), ProgramFiles: join(root, "empty") });
    expect((await missing.statuses("wireshark-tshark")).find(({ name }) => name === "tshark")).toEqual({
      name: "tshark",
      kind: "find",
      state: "missing",
      problem: "notFound",
      hint,
      link: "https://www.wireshark.org/download.html",
    });
    expect(await missing.resolve(plugin, "tshark")).toBeUndefined();
    expect(spawned).toEqual([]);
    missing.close();

    const standard = join(programFiles, "Wireshark", "tshark.exe");
    await writeFile(standard, "fixture");
    const installed = provisioner("win32", { PATH: join(root, "empty"), ProgramFiles: programFiles });
    expect(await installed.resolve(plugin, "tshark")).toMatchObject({
      executable: standard,
      version: "4.6.8",
    });
    installed.close();

    const path = join(onPath, "tshark.exe");
    await writeFile(path, "fixture");
    const first = provisioner("win32", { PATH: onPath, ProgramFiles: programFiles });
    expect(await first.resolve(plugin, "tshark")).toMatchObject({ executable: path, version: "4.6.8" });
    first.close();

    // A Linux PATH splits on ':', which a Windows drive letter would break.
    if (!windows) {
      const linux = join(onPath, "tshark");
      await writeFile(linux, "fixture", { mode: 0o755 });
      const onLinux = provisioner("linux", { PATH: onPath });
      expect(await onLinux.resolve(plugin, "tshark")).toMatchObject({ executable: linux, version: "4.6.8" });
      onLinux.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const step = (args: readonly string[]) => ({
  toolCalls: [{ name: "run_program", args: { program: "tshark", args } }],
});
const script = (items: unknown[]) => items.map((item) => JSON.stringify(item)).join("\n");
const typed = (operation: string, args: Record<string, unknown> = {}) => ({
  toolCalls: [{ name: "wireshark_capture", args: { operation, ...args } }],
});
const importCapture = (path: string) => ({ toolCalls: [{ name: "wireshark_import", args: { path } }] });

it("offers the typed capture contract in the model tool registry", () => {
  const registry = new core.ToolRegistry();
  const spec = registry.available().find(({ name }) => name === "wireshark_capture");
  const derive = registry.available().find(({ name }) => name === "wireshark_derive");
  const usesSource = { source: { path: classicPath } };
  expect(derive?.params.safeParse({ operation: "clean", ...usesSource, remove: ["secrets"] }).success).toBe(
    true,
  );
  expect(
    derive?.params.safeParse({ operation: "clean", ...usesSource, remove: ["secrets"], argv: ["-w"] })
      .success,
  ).toBe(false);
  expect(
    derive?.params.safeParse({ operation: "split", ...usesSource, by: { kind: "time", seconds: "0" } })
      .success,
  ).toBe(false);
  expect(derive?.params.safeParse({ operation: "merge", ...usesSource }).success).toBe(false);
  expect(spec?.params.safeParse({ operation: "capabilities" }).success).toBe(true);
  expect(spec?.params.safeParse({ operation: "capabilities", argv: ["-i", "1"] }).success).toBe(false);
  expect(spec?.params.safeParse({ operation: "inspect" }).success).toBe(false);
  const scoped = { operation: "network", source: { path: classicPath }, networkProfile: "tcp_udp" };
  expect(spec?.params.safeParse({ ...scoped, networkQuery: { kind: "tcp_symptoms" } }).success).toBe(true);
  expect(spec?.params.safeParse({ ...scoped, networkQuery: { kind: "conversations" } }).success).toBe(false);
  expect(
    spec?.params.safeParse({ ...scoped, networkProfile: "tls", networkQuery: { kind: "tcp_symptoms" } })
      .success,
  ).toBe(false);
  expect(spec?.params.safeParse({ ...scoped, fields: ["tcp.payload"] }).success).toBe(false);
  const media = { operation: "media", ...usesSource, mediaProfile: "voip" };
  expect(spec?.params.safeParse({ ...media, rtpPort: 5004 }).success).toBe(true);
  expect(spec?.params.safeParse({ ...media, mediaProfile: "wifi", rtpPort: 5004 }).success).toBe(false);
  expect(spec?.params.safeParse({ ...media, limit: 13 }).success).toBe(false);
  expect(spec?.params.safeParse({ ...media, fields: ["rtp.payload"] }).success).toBe(false);
  expect(
    spec?.params.safeParse({ operation: "inspect", source: { path: classicPath }, profile: "custom" })
      .success,
  ).toBe(false);
  expect(
    new core.ToolRegistry().specs().find(({ name }) => name === "wireshark_capture")?.parameters,
  ).toMatchObject({
    type: "object",
    properties: { operation: { type: "string" } },
  });
});

/**
 * A workbench with the catalog-installed plugin, its skills and the host's real tshark. The host keeps
 * PATH and ProgramFiles for discovery but isolates the personal Wireshark profile through HOME.
 */
async function workbench(
  scripts: Record<string, unknown[]>,
  state: "enabled" | "missing_binary" | "local" | "tshark_only" | "no_text2pcap" = "enabled",
  permissions?: core.PermissionEngine,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-tshark-replay-")));
  const bench = join(root, "bench");
  const home = join(root, "home");
  const personal = windows ? join(home, "AppData", "Wireshark") : join(home, ".config", "wireshark");
  const native = new core.NodeProcessHost(spawn);
  const starts: (readonly string[])[] = [];
  let onNativeStart: ((args: readonly string[]) => void) | undefined;
  const configurations: string[] = [];
  const host: core.ProcessHost = {
    platform: native.platform,
    env: { ...native.env, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData") },
    spawn(executable, args, options) {
      starts.push([...args]);
      configurations.push(options.env.WIRESHARK_CONFIG_DIR ?? "");
      const child = native.spawn(executable, args, options);
      onNativeStart?.(args);
      return child;
    },
    signal: native.signal.bind(native),
  };
  const runner = new core.ProgramRunner({ host, clock: { sleep } });
  const opened: {
    service?: core.SessionService;
    provisioner?: core.Provisioner;
    database?: Awaited<ReturnType<typeof core.openDb>>;
  } = {};
  const close = async () => {
    await opened.service?.close();
    await runner.stopAll();
    opened.provisioner?.close();
    opened.database?.close();
    await rm(root, { recursive: true, force: true });
  };
  await mkdir(join(bench, ".vera"), { recursive: true });
  await mkdir(join(bench, "captures"));
  await mkdir(home);
  await mkdir(personal, { recursive: true });
  await writeFile(join(bench, "captures/sample.pcapng"), await readFile(sample));
  await mkdir(join(root, "scripts"));
  const writeReplay = (name: string, items: unknown[]) =>
    writeFile(join(root, `scripts/${name}.jsonl`), script(items));
  for (const [name, items] of Object.entries(scripts)) await writeReplay(name, items);
  const release = await core.buildCatalogRelease(fileURLToPath(plugins), join(root, "release"));
  expect(release.issues).toEqual([]);
  expect(release.index?.plugins.find((item) => item.id === "wireshark-tshark")?.tier).toBe("official");
  const store = new core.PluginStore({ root: join(root, "plugins") });
  await store.install(
    join(root, `release/wireshark-tshark-${(await manifest()).version}.zip`),
    undefined,
    state === "local" ? undefined : { tier: "official", url: "https://fixture.invalid/wireshark.zip" },
  );
  const plugin = await store.load("wireshark-tshark");
  const skills = new core.SkillCatalog({
    root: bench,
    disabled: () => [],
    plugins: async () => [{ id: "wireshark-tshark", folder: plugin.folder }],
  });
  const provisioner = new core.Provisioner({
    store,
    host,
    root: join(root, "runtime"),
    platform: windows ? "windows-x64" : "linux-x64",
    clock: { sleep },
    settings: () => undefined,
    fetch: async () => {
      throw Error("tshark must never download");
    },
  });
  opened.provisioner = provisioner;
  const tshark = await provisioner.resolve(plugin, "tshark");
  let model = "";
  let resultChars = 32_000;
  let redact = (text: string) => text;
  const modelResults: string[] = [];
  const start = async () => {
    const gateway = new (class extends ReplayGateway {
      override async *stream(request: Parameters<ReplayGateway["stream"]>[0]) {
        for (const message of request.messages) {
          if (message.role === "toolResult" && message.toolName === "wireshark_capture")
            for (const item of message.content) if (item.type === "text") modelResults.push(item.text);
        }
        yield* super.stream(request);
      }
    })({ dir: join(root, "scripts"), now: Date.now, contextWindow: 131_072 });
    await gateway.models("replay", new AbortController().signal);
    opened.database = await core.openDb(join(bench, ".vera/vera.db"), {
      workbenchId: "wb_test",
      appVersion: "0",
    });
    opened.service = new core.SessionService({
      root: bench,
      db: opened.database.db,
      gateway,
      clock: { now: () => new Date(), sleep },
      model: () => model,
      maxToolCallsPerTurn: 50,
      advanced: { app: () => ({ toolResultChars: resultChars }), workbench: () => undefined },
      scrub: (text) => redact(text),
      ...(permissions && { permissions }),
      prompt: () => "Use the Wireshark plugin",
      skills,
      programs: {
        runner,
        clock: { sleep },
        plugins: async () => [plugin],
        resolver:
          state === "missing_binary"
            ? core.unresolvedPrograms
            : state === "tshark_only" || state === "no_text2pcap"
              ? {
                  resolve: (plugin, program, signal) =>
                    (state === "tshark_only" ? program === "tshark" : program !== "text2pcap")
                      ? provisioner.resolve(plugin, program, signal)
                      : Promise.resolve(undefined),
                }
              : provisioner,
      },
      wiresharkPackage: state === "local" ? undefined : plugin.record.sha256,
    });
    await opened.service.waitReady();
    return opened.service;
  };
  const session = (service: core.SessionService, name: string, mode: "ask" | "bypass" | "read-only") => {
    model = `replay/${name}`;
    const created = service.create(null, mode);
    const outputs: { ok: boolean; summary: string }[] = [];
    service.subscribe(created.id, 0, (_seq, event) => {
      if (event.type === "tool.done") outputs.push({ ok: event.ok, summary: event.summary });
    });
    const pending = () => service.get(created.id).snapshot.approvals.find((item) => !item.decision);
    return { id: created.id, outputs, pending };
  };
  return {
    bench,
    runner,
    skills,
    tshark,
    starts,
    configurations,
    start,
    session,
    close,
    writeReplay,
    modelResults,
    onNativeStart: (callback: (args: readonly string[]) => void) => {
      onNativeStart = callback;
    },
    database: () => {
      if (!opened.database) throw Error("The workbench database is not open.");
      return opened.database.db;
    },
    resultBudget(limit: number, scrub: (text: string) => string) {
      resultChars = limit;
      redact = scrub;
    },
    async personalProfileControl() {
      if (!tshark) throw Error("TShark is required.");
      await writeFile(join(personal, "disabled_protos"), "coap\n");
      const { stdout } = await promisify(execFile)(
        tshark.executable,
        ["-n", "-r", sample, "-Y", "coap", "-T", "fields", "-e", "frame.number"],
        {
          env: { ...host.env, WIRESHARK_CONFIG_DIR: personal },
          timeout: 10_000,
          windowsHide: true,
        },
      );
      return stdout.trim();
    },
  };
}

const results = (outputs: { summary: string }[]) =>
  outputs.map((output) => JSON.parse(output.summary) as { exitCode: number; output: string });

const classicPath = "captures/independent.pcap";
const classicPcap = Buffer.from(
  "d4c3b2a1020004000000000000000000ffff000001000000" +
    "0100000020a107002e0000002e000000" +
    "0200000000020200000000010800450000200001000040110000c0000201c0000202bf3f1634000c000040010001",
  "hex",
);

it("gates typed capture capabilities on the official plugin independently of the executable", async () => {
  const hash = createHash("sha256").update(classicPcap).digest("hex");
  const reference = {
    format: 1,
    bytes: classicPcap.length,
    sha256: hash,
    fileFormat: "pcap",
    source: { kind: "managed" },
  };
  for (const state of ["missing_binary", "local"] as const) {
    const rig = await workbench(
      {
        test: [
          typed("capabilities"),
          typed("inspect", { source: { path: classicPath } }),
          typed("verify_reference", { source: { reference } }),
          importCapture(classicPath),
          { text: "Done." },
        ],
      },
      state,
      core.readPermissions,
    );
    try {
      await mkdir(join(rig.bench, ".vera/captures"));
      await writeFile(join(rig.bench, ".vera/captures", `${hash}.pcap`), classicPcap);
      const service = await rig.start();
      const session = rig.session(service, "test", "ask");
      const firstStart = rig.starts.length;
      service.send(session.id, "Check the offline capture capability.");
      await service.waitIdle(session.id);
      expect(rig.starts.length).toBe(firstStart);
      if (state === "local") {
        expect(session.outputs.every(({ ok }) => !ok)).toBe(true);
        expect(JSON.stringify(session.outputs)).not.toContain("managedStorage");
      } else {
        expect(JSON.parse(session.outputs[0]?.summary ?? "")).toMatchObject({
          tshark: { available: false },
          managedStorage: { readable: true, writable: true, importAvailable: false },
        });
        expect(JSON.parse(session.outputs[1]?.summary ?? "")).toMatchObject({ reason: "tshark_unavailable" });
        expect(JSON.parse(session.outputs[2]?.summary ?? "")).toEqual({ capture: reference, verified: true });
        expect(session.outputs[3]).toMatchObject({ ok: false, summary: "Tool permission denied." });
      }
    } finally {
      await rig.close();
    }
  }
}, 90_000);

it("replays typed Windows or Linux offline analysis with independent PCAP and PCAPNG evidence", async (ctx) => {
  const pcapng = { path: "captures/sample.pcapng" };
  const pcap = { path: classicPath };
  const decodeAs = [{ transport: "udp", port: 5684, protocol: "coap" }];
  const hash = createHash("sha256").update(classicPcap).digest("hex");
  const managed = {
    format: 1,
    bytes: classicPcap.length,
    sha256: hash,
    fileFormat: "pcap",
    source: { kind: "managed" },
  };
  const decodeFields = ["coap.code", "udp.dstport"];
  const rig = await workbench({
    test: [
      typed("capabilities"),
      typed("discover", { kind: "fields", search: "uri_path_recon" }),
      typed("discover", { kind: "protocols", search: "coap", limit: 2 }),
      typed("discover", { kind: "decoders", search: "coap" }),
      typed("validate_filter", { filter: "(" }),
      typed("validate_filter", { filter: "coap" }),
      typed("inspect", { source: pcapng }),
      typed("query", {
        source: pcapng,
        filter: "coap",
        fields: ["coap.opt.uri_path_recon"],
        scanFrames: 5,
        limit: 1,
      }),
      typed("frame", { source: pcap, frame: 1, fields: decodeFields, decodeAs }),
      typed("frame", { source: pcap, frame: 2 }),
      typed("query", { source: pcap, fields: ["udp.nonsense"] }),
      typed("query", { source: pcap, fields: decodeFields, cursor: { querySha256: hash, afterFrame: 1 } }),
      importCapture(classicPath),
      typed("frame", { source: { reference: managed }, frame: 1, fields: decodeFields, decodeAs }),
      typed("inspect", { source: { path: "captures/corrupt.pcap" } }),
      typed("inspect", { source: { path: "captures/huge.pcap" } }),
      typed("inspect", { source: { path: "../outside.pcap" } }),
      typed("inspect", { source: { reference: { ...managed, bytes: managed.bytes + 1 } } }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1")
        throw Error("Native TShark is required for this acceptance run.");
      ctx.skip("TShark unavailable for typed offline capture acceptance.");
      return;
    }
    expect(await rig.personalProfileControl()).toBe("");
    await writeFile(join(rig.bench, classicPath), classicPcap);
    await writeFile(join(rig.bench, "captures/corrupt.pcap"), classicPcap.subarray(0, 31));
    await writeFile(join(rig.bench, "captures/huge.pcap"), classicPcap);
    await truncate(join(rig.bench, "captures/huge.pcap"), captureLimits.analysisBytes + 1);
    const service = await rig.start();
    const session = rig.session(service, "test", "ask");
    const firstStart = rig.starts.length;
    service.send(session.id, "Analyze the saved fixtures offline.");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const outputs = session.outputs.map(({ summary }) => JSON.parse(summary));
    expect(outputs).toHaveLength(18);
    expect(outputs[0]).toMatchObject({ tshark: { available: true }, profile: "vera-offline-v1" });
    expect(outputs[1].entries).toContainEqual(expect.objectContaining({ name: "coap.opt.uri_path_recon" }));
    expect(outputs[2].entries).toContainEqual(expect.objectContaining({ name: "coap" }));
    expect(outputs[3].entries).toContainEqual(expect.objectContaining({ name: "coap", transport: "udp" }));
    expect(outputs[4]).toMatchObject({ isError: true, reason: "invalid_filter" });
    expect(outputs[5]).toMatchObject({ valid: true });
    const inspected = captureReferenceSchema.parse(outputs[6].capture);
    expect(inspected.fileFormat).toBe("pcapng");
    expect(inspected.sha256).toBe(
      createHash("sha256")
        .update(await readFile(sample))
        .digest("hex"),
    );
    expect(outputs[6].coverage).toMatchObject({ scannedThrough: 8, scanComplete: true, partial: false });
    expect(outputs[7]).toMatchObject({
      columns: ["frame", "time", "bytes", "ref", "coap.opt.uri_path_recon"],
      rows: [
        [3, "1767225600.200000000", 60, expect.stringMatching(/^capture:[a-f0-9]{64}#f=3$/), "/sensors/temp"],
      ],
      packetData: "untrusted_capture_data",
      coverage: { scannedThrough: 5, scanComplete: false, partial: true, returned: 1 },
      page: { limit: 1, next: { afterFrame: 3 } },
    });
    expect(outputs[8]).toMatchObject({
      capture: { sha256: hash },
      analysis: { profile: "vera-offline-v1", decodeAs },
    });
    // A classic PCAP names no interface, so its rows carry the interface column (null).
    const cell = (name: string) => outputs[8].rows[0][outputs[8].columns.indexOf(name)];
    expect(outputs[8].rows).toHaveLength(1);
    expect(["frame", "time", "interface", "coap.code", "udp.dstport"].map(cell)).toEqual([
      1,
      "1.500000000",
      null,
      "1",
      "5684",
    ]);
    expect(outputs[10].error).toContain("udp.nonsense");
    expect(outputs[9]).toMatchObject({ reason: "frame_not_found" });
    expect(outputs[10]).toMatchObject({ reason: "field_unavailable" });
    expect(outputs[11]).toMatchObject({ reason: "cursor_mismatch" });
    expect(outputs[12]).toMatchObject({ capture: managed });
    const refAt = outputs[8].columns.indexOf("ref");
    const [sourceRow] = outputs[8].rows;
    const [managedRow] = outputs[13].rows;
    const sourceCitation = sourceRow[refAt];
    const withoutRef = (row: unknown[]) => row.filter((_, index) => index !== refAt);
    expect(outputs[13]).toMatchObject({ capture: managed, columns: outputs[8].columns });
    expect(withoutRef(managedRow)).toEqual(withoutRef(sourceRow));
    expect(sourceCitation).toMatch(/^capture:[a-f0-9]{64}#f=1$/);
    expect(managedRow[refAt]).toMatch(/^capture:[a-f0-9]{64}#f=1$/);
    expect(managedRow[refAt]).not.toBe(sourceCitation);
    expect(outputs[14]).toMatchObject({ reason: "invalid_capture" });
    expect(outputs[15]).toMatchObject({ reason: "capture_byte_limit" });
    expect(outputs[16]).toMatchObject({ reason: "capture_inaccessible" });
    expect(outputs[17]).toMatchObject({ reason: "capture_changed" });
    const stored = join(rig.bench, ".vera/captures");
    expect(await readdir(stored)).toEqual([`${hash}.pcap`]);
    expect(await readFile(join(stored, `${hash}.pcap`))).toEqual(classicPcap);
    expect(service.get(session.id).snapshot.approvals).toEqual([]);
    const isolatedStarts = rig.starts
      .slice(firstStart)
      .flatMap((args, index) =>
        args[0] !== "--version" ? [{ args, config: rig.configurations[firstStart + index] }] : [],
      );
    expect(
      isolatedStarts.every(
        ({ args }) => args[0] === "-G" || args[0] === "--help" || (args[0] === "-n" && args.includes("-r")),
      ),
    ).toBe(true);
    expect(isolatedStarts.every(({ config }) => config?.includes("vera-offline-"))).toBe(true);

    const cursor = outputs[7].page.next;
    const changed = Buffer.from(classicPcap);
    changed[changed.length - 1] = 9;
    await writeFile(join(stored, `${hash}.pcap`), changed);
    const nextCapture = "captures/next.pcap";
    await writeFile(join(rig.bench, nextCapture), changed);
    for (let index = 1; index < captureLimits.managedFiles; index++)
      await writeFile(join(stored, `${index.toString(16).padStart(64, "0")}.pcap`), classicPcap);
    const nextPage = {
      source: { reference: inspected },
      filter: "coap",
      fields: ["coap.opt.uri_path_recon"],
      scanFrames: 5,
      limit: 1,
      cursor,
    };
    await rig.writeReplay("continue", [
      typed("query", nextPage),
      typed("query", { ...nextPage, filter: "udp" }),
      typed("inspect", { source: { reference: managed } }),
      importCapture(nextCapture),
      typed("validate_filter", { filter: "udp.payload contains 12:34" }),
      typed("validate_filter", { filter: 'ip.addr == "not-resolved.example"' }),
      typed("validate_filter", {
        filter: "udp",
        decodeAs: [{ transport: "udp", port: 5684, protocol: "absent" }],
      }),
      { text: "Done." },
    ]);
    const continuation = rig.session(service, "continue", "ask");
    service.send(continuation.id, "Continue the saved query.");
    expect(await service.waitIdle(continuation.id)).toEqual({ stopReason: "end" });
    const more = continuation.outputs.map(({ summary }) => JSON.parse(summary));
    expect(more[0]).toMatchObject({
      capture: { sha256: inspected.sha256 },
      rows: [[4, expect.any(String), expect.any(Number), expect.any(String), "/sensors/temp"]],
      page: { limit: 1, afterFrame: 3, next: null },
      coverage: { matchedInScope: 2, partial: true },
    });
    expect(more.slice(1).map(({ reason }) => reason)).toEqual([
      "cursor_mismatch",
      "capture_changed",
      "storage_quota",
      undefined,
      "invalid_filter",
      "invalid_decode_as",
    ]);
    // Any filter TShark accepts is valid; a host name is never looked up.
    expect(more[4]).toMatchObject({ valid: true });
    expect(more[5].error).toContain("not-resolved.example");
    expect(await readdir(stored)).toHaveLength(captureLimits.managedFiles);

    const repeated = "captures/repeated.pcap";
    const frameBytes = classicPcap.subarray(24);
    await writeFile(
      join(rig.bench, repeated),
      Buffer.concat([classicPcap.subarray(0, 24), ...Array<Buffer>(28).fill(frameBytes)]),
    );
    await rig.writeReplay("budget", [
      typed("query", { source: { path: repeated }, fields: ["ip.src"], limit: 28 }),
      { text: "Done." },
    ]);
    const mask = (text: string) => text.replaceAll("192.0.2.1", "[masked]".repeat(22));
    for (const limit of [8000, 32_000]) {
      rig.resultBudget(limit, mask);
      rig.modelResults.length = 0;
      const budget = rig.session(service, "budget", "ask");
      service.send(budget.id, "Summarize this controlled capture.");
      expect(await service.waitIdle(budget.id)).toEqual({ stopReason: "end" });
      const text = rig.modelResults.at(-1) ?? "";
      expect(text.length).toBeLessThanOrEqual(limit);
      expect(text).not.toContain("192.0.2.1");
      const page = JSON.parse(text);
      expect(page.rows[0][page.columns.indexOf("ip.src")]).toBe("[masked]".repeat(22));
      if (limit === 8000) {
        expect(page.rows.length).toBeLessThan(28);
        expect(page.coverage).toMatchObject({
          partial: true,
          truncated: true,
          returned: page.rows.length,
        });
        expect(page.page.next.afterFrame).toBe(page.rows.at(-1)[0]);
      } else {
        expect(page.rows).toHaveLength(28);
        expect(page.coverage).toMatchObject({ partial: false, truncated: false, returned: 28 });
        expect(page.page.next).toBeNull();
      }
    }
  } finally {
    await rig.close();
  }
}, 120_000);

/** A classic PCAP of identical UDP frames from 192.168.7.10 to 192.168.7.1, one per millisecond. */
function syntheticCapture(frames: number, size: number, port: (index: number) => number) {
  const record = 16 + size;
  const body = Buffer.alloc(frames * record);
  for (let index = 0; index < frames; index++) {
    const at = index * record;
    body.writeUInt32LE(1_700_000_000 + Math.floor(index / 1000), at);
    body.writeUInt32LE((index % 1000) * 1000, at + 4);
    body.writeUInt32LE(size, at + 8);
    body.writeUInt32LE(size, at + 12);
    const frame = body.subarray(at + 16, at + record);
    Buffer.from("020000000002020000000001", "hex").copy(frame, 0);
    frame.writeUInt16BE(0x0800, 12);
    frame[14] = 0x45;
    frame.writeUInt16BE(size - 14, 16);
    frame[22] = 64;
    frame[23] = 17;
    Buffer.from("c0a8070ac0a80701", "hex").copy(frame, 26);
    frame.writeUInt16BE(50000, 34);
    frame.writeUInt16BE(port(index), 36);
    frame.writeUInt16BE(size - 34, 38);
  }
  return Buffer.concat([classicPcap.subarray(0, 24), body]);
}

it("reads any field and filter, a frame's tree and bytes, stream payload and frames past the first window", async (ctx) => {
  const coap = { path: "captures/sample.pcapng" };
  const traffic = { path: "captures/traffic.pcapng" };
  const long = { path: "captures/long.pcap" };
  const large = { path: "captures/large.pcap" };
  const rig = await workbench({
    open: [
      typed("query", { source: coap, filter: "coap", fields: ["coap.code", "udp.payload", "mqtt.topic"] }),
      typed("query", {
        source: traffic,
        filter: "tcp.analysis.retransmission",
        fields: ["tcp.seq", "tcp.len"],
      }),
      typed("query", { source: coap, filter: 'frame contains "temp"' }),
      typed("query", { source: coap, fields: ["coap.nonsense"] }),
      typed("query", { source: coap, filter: "tcp.prot == 80" }),
      typed("discover", { kind: "fields", search: "mqtt.topic" }),
      typed("frame", { source: coap, frame: 4, tree: true, bytes: true }),
      typed("follow", { source: traffic, transport: "tcp", stream: 0, payload: "text" }),
      typed("follow", { source: traffic, transport: "tcp", stream: 0, payload: "hex" }),
      typed("follow", { source: traffic, transport: "tcp", stream: 0 }),
      typed("inspect", { source: long }),
      typed("inspect", { source: long, scanFrom: 50_000 }),
      typed("query", { source: long, scanFrom: 50_000, filter: "udp.port == 40001", limit: 2 }),
      typed("frame", { source: long, frame: 55_000 }),
      typed("frame", { source: long, frame: 70_000 }),
      typed("inspect", { source: large }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    await writeFile(join(rig.bench, traffic.path), await readFile(trafficSample));
    // 60,000 frames: the first 50,000 to port 40000, the rest to port 40001.
    await writeFile(
      join(rig.bench, long.path),
      syntheticCapture(60_000, 46, (index) => (index < 50_000 ? 40000 : 40001)),
    );
    // Larger than a retained capture may be, smaller than one that is only read.
    const largeBytes = syntheticCapture(45_000, 1514, () => 40000);
    expect(largeBytes.length).toBeGreaterThan(captureLimits.captureBytes);
    await writeFile(join(rig.bench, large.path), largeBytes);
    const service = await rig.start();
    const run = rig.session(service, "open", "read-only");
    service.send(run.id, "Read the captures.");
    expect(await service.waitIdle(run.id)).toEqual({ stopReason: "end" });
    const [
      payload,
      retransmission,
      contains,
      unknownField,
      wrongFilter,
      discovered,
      detail,
      text,
      hex,
      counts,
      firstWindow,
      secondWindow,
      windowRows,
      farFrame,
      absentFrame,
      largeCapture,
    ] = run.outputs.map(({ summary }) => JSON.parse(summary));
    expect(run.outputs).toHaveLength(16);
    expect(payload.columns).toEqual([
      "frame",
      "time",
      "bytes",
      "ref",
      "coap.code",
      "udp.payload",
      "mqtt.topic",
    ]);
    expect(payload.rows).toHaveLength(4);
    expect(payload.rows[0]).toEqual([
      3,
      "1767225600.200000000",
      60,
      expect.stringMatching(/^capture:[a-f0-9]{64}#f=3$/),
      "1",
      "4101123471b773656e736f72730474656d70",
      null,
    ]);
    expect(retransmission.rows).toEqual([[5, expect.any(String), 73, expect.any(String), "1", "19"]]);
    expect(contains.rows.map((row: unknown[]) => row[0])).toEqual([3]);
    expect(unknownField).toMatchObject({ isError: true, reason: "field_unavailable" });
    expect(unknownField.error).toContain("coap.nonsense");
    expect(wrongFilter).toMatchObject({ isError: true, reason: "invalid_filter" });
    expect(wrongFilter.error).toContain("tcp.prot");
    expect(discovered.entries).toContainEqual({ name: "mqtt.topic", description: "Topic" });
    expect(detail.rows[0][0]).toBe(4);
    expect(detail.tree).toContain("Frame 4:");
    expect(detail.tree).toContain("Constrained Application Protocol");
    expect(detail.hex).toMatch(/^0000 {2}(?:[0-9a-f]{2} ){8}/m);
    const sent = (result: { traffic: { rows: { payload?: string }[] } }) =>
      result.traffic.rows.map((row) => row.payload).filter((value) => value !== undefined);
    expect(text.traffic.summary.payloadView).toBe("text_per_record");
    expect(sent(text)).toContain("VERA_LOCAL_SENTINEL");
    expect(sent(hex)).toContain(Buffer.from("VERA_LOCAL_SENTINEL").toString("hex"));
    // Without the option a stream shows byte counts only.
    expect(sent(counts)).toEqual([]);
    expect(JSON.stringify(counts)).not.toContain("VERA_LOCAL_SENTINEL");
    expect(firstWindow.coverage).toMatchObject({
      scannedThrough: 50_000,
      scanComplete: false,
      partial: true,
    });
    expect(secondWindow.coverage).toMatchObject({
      scanFrom: 50_000,
      scannedThrough: 60_000,
      scanComplete: true,
      matchedInScope: 10_000,
    });
    expect(windowRows.rows.map((row: unknown[]) => row[0])).toEqual([50_001, 50_002]);
    expect(windowRows.coverage).toMatchObject({ scanFrom: 50_000, matchedInScope: 10_000 });
    expect(windowRows.page.next).toMatchObject({ afterFrame: 50_002 });
    expect(farFrame.rows[0][0]).toBe(55_000);
    expect(absentFrame).toMatchObject({ isError: true, reason: "frame_not_found" });
    expect(largeCapture.capture.bytes).toBe(largeBytes.length);
    expect(largeCapture.coverage).toMatchObject({ scannedThrough: 45_000, scanComplete: true });

    // A frame past the first window is cited and opened in Wireshark Desktop like any other.
    const farRef: string = farFrame.rows[0][farFrame.columns.indexOf("ref")];
    await rig.writeReplay("far-citation", [
      typed("frame", { source: long, frame: 55_000 }),
      { text: `The frame. [[${farRef}]]` },
    ]);
    const cite = rig.session(service, "far-citation", "read-only");
    service.send(cite.id, "Cite the frame.");
    await service.waitIdle(cite.id);
    const assistant = service
      .get(cite.id)
      .snapshot.items.find(
        (item) =>
          item.kind === "assistant" && item.citations.some(({ ref, valid }) => ref === farRef && valid),
      );
    expect(assistant).toBeDefined();
    const located = service.openCaptureCitation(cite.id, assistant?.id ?? "", farRef);
    const viewer = await mkdtemp(join(rig.bench, "viewer-"));
    const viewerCopy = join(viewer, "long.pcap");
    const open = await core.prepareWiresharkFrame(
      located.context,
      located.evidence,
      undefined,
      rig.runner,
      rig.tshark.executable,
      viewer,
      viewerCopy,
      AbortSignal.timeout(captureLimits.deadlineMs),
    );
    expect(open.args).toEqual(["-n", "-r", viewerCopy, "-g", "55000"]);
  } finally {
    await rig.close();
  }
}, 180_000);

it("reads a protocol with its preset and passes a TLS key log to TShark", async (ctx) => {
  const coap = { path: "captures/sample.pcapng" };
  const traffic = { path: "captures/traffic.pcapng" };
  const keys = "captures/keys.log";
  const rig = await workbench({
    presets: [
      typed("capabilities"),
      typed("query", { source: coap, preset: "coap", limit: 2 }),
      typed("query", { source: coap, preset: "modbus" }),
      typed("query", { source: traffic, preset: "dns" }),
      typed("query", { source: coap, preset: "mqtt" }),
      typed("query", { source: coap, preset: "coap", filter: "coap.code == 69", fields: ["coap.mid"] }),
      typed("query", { source: traffic, preset: "http", tlsKeylog: keys }),
      typed("frame", { source: traffic, frame: 14, tlsKeylog: keys }),
      typed("query", { source: traffic, preset: "http" }),
      typed("query", { source: traffic, preset: "http", tlsKeylog: "captures/absent.log" }),
      typed("query", { source: traffic, preset: "http", tlsKeylog: "../outside.log" }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    await writeFile(join(rig.bench, traffic.path), await readFile(trafficSample));
    // The key log of no session: TShark reads it and decrypts nothing, which is enough to see it arrive.
    const keyLog = Buffer.from("# no session keys\n");
    await writeFile(join(rig.bench, keys), keyLog);
    const keySha256 = createHash("sha256").update(keyLog).digest("hex");
    const service = await rig.start();
    const run = rig.session(service, "presets", "read-only");
    const firstStart = rig.starts.length;
    service.send(run.id, "Read the protocols.");
    expect(await service.waitIdle(run.id)).toEqual({ stopReason: "end" });
    const [capabilities, coapRows, modbus, dns, mqtt, own, withKeys, frame, withoutKeys, absent, outside] =
      run.outputs.map(({ summary }) => JSON.parse(summary));
    expect(run.outputs).toHaveLength(11);
    expect(capabilities).toMatchObject({
      presets: ["mqtt", "coap", "modbus", "dhcp", "dns", "http", "tls"],
      tlsKeylog: true,
    });
    const cells = (result: { columns: string[]; rows: unknown[][] }, name: string) =>
      result.rows.map((row) => row[result.columns.indexOf(name)]);
    expect(coapRows).toMatchObject({ analysis: { filter: "coap" }, coverage: { matchedInScope: 4 } });
    expect(coapRows.columns).toEqual(expect.arrayContaining(["coap.code", "coap.opt.uri_path_recon"]));
    expect(cells(coapRows, "coap.opt.uri_path_recon")).toEqual(["/sensors/temp", "/sensors/temp"]);
    expect(cells(coapRows, "coap.code")).toEqual(["1", "69"]);
    expect(modbus.analysis.filter).toBe("modbus");
    expect(cells(modbus, "modbus.func_code")).toEqual(["3", "3"]);
    expect(cells(modbus, "modbus.regval_uint16")).toEqual([null, ["235", "258"]]);
    expect(dns.analysis.filter).toBe("dns");
    expect(cells(dns, "dns.qry.name")).toContain("example.test");
    // A protocol the capture does not hold gives an empty page, not an error.
    expect(mqtt).toMatchObject({ analysis: { filter: "mqtt" }, coverage: { matchedInScope: 0 }, rows: [] });
    // The call's own filter and fields replace the preset's.
    expect(own.analysis.filter).toBe("coap.code == 69");
    expect(own.columns).toEqual(["frame", "time", "bytes", "ref", "coap.mid"]);
    expect(own.rows).toHaveLength(2);
    // The key log reaches TShark as a private copy, and its hash becomes part of the frame's citation.
    expect(withKeys.analysis).toMatchObject({ filter: "http", tlsKeylog: keySha256 });
    expect(frame.analysis.tlsKeylog).toBe(keySha256);
    expect(withoutKeys.analysis.tlsKeylog).toBeUndefined();
    const ref = (result: { columns: string[]; rows: unknown[][] }) => cells(result, "ref")[0];
    expect(cells(withKeys, "frame")).toEqual(cells(withoutKeys, "frame"));
    expect(ref(withKeys)).not.toBe(ref(withoutKeys));
    const keyed = rig.starts
      .slice(firstStart)
      .filter((args) => args.some((arg) => arg.startsWith("tls.keylog_file:")));
    expect(keyed.length).toBeGreaterThan(0);
    for (const args of keyed) {
      const option = args.find((arg) => arg.startsWith("tls.keylog_file:")) ?? "";
      expect(args[args.indexOf(option) - 1]).toBe("-o");
      expect(option).toContain("vera-offline-");
      expect(option).not.toContain(rig.bench);
    }
    expect(absent).toMatchObject({ isError: true, reason: "keylog_inaccessible" });
    expect(outside).toMatchObject({ isError: true, reason: "keylog_inaccessible" });
  } finally {
    await rig.close();
  }
}, 120_000);

it("reconciles typed offline traffic statistics and directional streams with native TShark", async (ctx) => {
  const source = { path: "captures/sample.pcapng" };
  const trafficSource = { path: "captures/traffic.pcapng" };
  const stat = (statistic: object, options: object = {}) =>
    typed("statistics", { source, statistic, ...options });
  const follow = (transport: string, stream: number, options: object = {}) =>
    typed("follow", { source, transport, stream, ...options });
  const rates = { kind: "traffic", intervalMs: 300 };
  const window = { startMs: -300, endMs: 800 };
  const rig = await workbench({
    traffic: [
      stat({ kind: "protocol_hierarchy" }),
      stat({ kind: "endpoints", layer: "udp" }),
      stat({ kind: "conversations", layer: "tcp" }),
      stat(rates, { window }),
      follow("udp", 0),
      follow("tcp", 0),
      stat({ kind: "diagnostics" }, { source: trafficSource, validateChecksums: true }),
      stat({ kind: "response_timing", protocol: "dns" }, { source: trafficSource }),
      stat(
        { kind: "response_timing", protocol: "http" },
        {
          source: trafficSource,
          filter: "frame.number == 15",
        },
      ),
      follow("tcp", 0, { source: trafficSource, limit: 2 }),
      follow("udp", 1, { source: trafficSource }),
      stat({ kind: "endpoints", layer: "ipv6" }, { source: trafficSource }),
      stat({ kind: "endpoints", layer: "ethernet" }),
      stat({ kind: "conversations", layer: "ipv4" }),
      follow("tcp", 12, { source: trafficSource, scanFrames: 5 }),
      stat({ kind: "traffic", intervalMs: 1 }, { window }),
      stat(rates),
      stat({ kind: "protocol_hierarchy" }, { scanFrames: 5, filter: "udp" }),
      stat({ kind: "response_timing", protocol: "quic" }),
      follow("tcp", 12, { source: trafficSource }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("TShark unavailable for offline traffic acceptance.");
      return;
    }
    await writeFile(join(rig.bench, trafficSource.path), await readFile(trafficSample));
    const untimedSource = { path: "captures/untimed.pcapng" };
    await writeFile(join(rig.bench, untimedSource.path), await readFile(untimedSample));
    const executable = rig.tshark.executable;
    const native = async (capture: string, args: string[]) =>
      (
        await promisify(execFile)(executable, ["-n", "-r", capture, ...args], {
          timeout: 10_000,
          windowsHide: true,
        })
      ).stdout;
    const fields = (...names: string[]) => ["-T", "fields", ...names.flatMap((name) => ["-e", name])];
    const nativeSample = (
      await native(sample, fields("frame.number", "frame.time_relative", "frame.len", "frame.protocols"))
    )
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split("\t"));
    const service = await rig.start();
    const session = rig.session(service, "traffic", "ask");
    service.send(session.id, "Summarize this synthetic capture.");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const outputs = session.outputs.map(({ summary }) => JSON.parse(summary));
    expect(session.outputs).toHaveLength(20);
    expect(session.outputs.slice(0, 14).filter(({ ok }) => !ok)).toEqual([]);

    const paths = new Set(
      nativeSample.flatMap(
        ([, , , stack]) =>
          stack?.split(":").map((_protocol, index, layers) => layers.slice(0, index + 1).join(":")) ?? [],
      ),
    );
    expect(outputs[0].traffic.rows).toEqual(
      [...paths].sort().map((path) => {
        const matches = nativeSample.filter(
          ([, , , stack]) => stack === path || stack?.startsWith(`${path}:`),
        );
        const bytes = matches.reduce((sum, row) => sum + Number(row[2]), 0);
        return {
          path: path.split(":"),
          frames: [Number(matches[0]?.[0])],
          packets: matches.length,
          wireBytes: bytes,
          capturedBytes: bytes,
        };
      }),
    );
    expect(outputs[0].traffic.summary).toMatchObject({ packets: 8, wireBytes: 445, capturedBytes: 445 });
    const nativeUdp = await native(sample, ["-q", "-z", "endpoints,udp"]);
    expect(nativeUdp).toMatch(
      /^192\.168\.7\.1[ \t]+40000[ \t]+4[ \t]+228(?: bytes)?[ \t]+2[ \t]+124(?: bytes)?[ \t]+2[ \t]+104(?: bytes)?[ \t]*\r?$/m,
    );
    expect(outputs[1].traffic.rows).toMatchObject([
      {
        endpoint: { address: "192.168.7.1", port: 40000 },
        tx: { packets: 2, wireBytes: 124 },
        rx: { packets: 2, wireBytes: 104 },
        packets: 4,
        wireBytes: 228,
        frames: [3, 4],
      },
      {
        endpoint: { address: "192.168.7.10", port: 5683 },
        tx: { packets: 2, wireBytes: 104 },
        rx: { packets: 2, wireBytes: 124 },
        packets: 4,
        wireBytes: 228,
        frames: [4, 3],
      },
    ]);
    const nativeTcp = await native(sample, ["-q", "-z", "conv,tcp"]);
    expect(nativeTcp).toMatch(
      /192\.168\.7\.1:50200\s+<->\s+192\.168\.7\.10:502\s+1 67 bytes\s+1 66 bytes\s+2 133 bytes/,
    );
    expect(outputs[2].traffic.rows).toMatchObject([
      {
        stream: 0,
        frames: [5, 6],
        packets: 2,
        wireBytes: 133,
        aToB: { packets: 1, wireBytes: 66 },
        bToA: { packets: 1, wireBytes: 67 },
      },
    ]);
    expect(outputs[3].traffic.rows).toEqual(
      [-300, 0, 300, 600].map((startMs) => {
        const endMs = Math.min(startMs + 300, window.endMs);
        const observed = nativeSample.filter(
          ([, seconds]) => Number(seconds) * 1000 >= startMs && Number(seconds) * 1000 < endMs,
        );
        const bytes = observed.reduce((sum, frame) => sum + Number(frame[2]), 0);
        const duration = (endMs - startMs) / 1000;
        return {
          startMs,
          endMs,
          packets: observed.length,
          wireBytes: bytes,
          capturedBytes: bytes,
          packetsPerSecond: observed.length / duration,
          wireBytesPerSecond: bytes / duration,
          capturedBytesPerSecond: bytes / duration,
          frames: observed.length ? [Number(observed[0]?.[0])] : [],
        };
      }),
    );
    expect(outputs[3].traffic.scopeCoverage.windowExtendsOutsideScannedTimeRange).toBe(true);

    for (const [index, capture, transport, stream] of [
      [4, sample, "udp", 0],
      [5, sample, "tcp", 0],
      [10, trafficSample, "udp", 1],
    ] as const) {
      const tap = await native(capture, ["-q", "-z", ["follow", transport, "yaml", stream].join(",")]);
      const rows = [
        ...tap.matchAll(
          /packet: (\d+)\r?\n +peer: (\d)\r?\n +timestamp: [^\r\n]+\r?\n +data: !!binary \|\r?\n +(\S+)/g,
        ),
      ].map(([, frame, peer, data]) => ({
        kind: "data",
        frames: [Number(frame)],
        direction: peer === "0" ? "a_to_b" : "b_to_a",
        payloadBytes: Buffer.from(data ?? "", "base64").length,
      }));
      expect(outputs[index].traffic.rows).toMatchObject(rows);
      expect(
        outputs[index].traffic.evidence.map(({ frame }: { frame: { number: number } }) => frame.number),
      ).toEqual([...new Set(rows.flatMap((row) => row.frames))].sort((a, b) => a - b));
    }
    expect(outputs[5].traffic.summary.tcp).toMatchObject({
      handshakeMarkersObserved: false,
      endMarkersObserved: false,
    });
    expect(outputs[10].traffic.summary.a.address).toBe("2001:db8::1");
    expect(outputs[11].traffic.rows).toMatchObject([
      { endpoint: { address: "2001:db8::1" }, frames: [16, 17], packets: 2, wireBytes: 130 },
      { endpoint: { address: "2001:db8::2" }, frames: [17, 16], packets: 2, wireBytes: 130 },
    ]);
    expect(outputs[12].traffic.rows).toMatchObject([
      { endpoint: { address: "02:00:00:00:00:01" }, frames: [1, 2], packets: 8, wireBytes: 445 },
      { endpoint: { address: "ff:ff:ff:ff:ff:ff" }, frames: [1], packets: 1, wireBytes: 42 },
      { endpoint: { address: "02:00:00:00:00:10" }, frames: [2, 3], packets: 7, wireBytes: 403 },
    ]);
    expect(outputs[13].traffic.rows).toMatchObject([
      {
        frames: [3, 4],
        packets: 6,
        wireBytes: 361,
        aToB: { packets: 3, wireBytes: 190 },
        bToA: { packets: 3, wireBytes: 171 },
      },
    ]);

    const verifiedFields = await native(trafficSample, [
      "-o",
      "tcp.check_checksum:TRUE",
      "-o",
      "udp.check_checksum:TRUE",
      ...fields(
        "frame.number",
        "tcp.analysis.retransmission",
        "tcp.analysis.lost_segment",
        "tcp.checksum.partial",
        "udp.checksum.status",
        "frame.len",
        "frame.cap_len",
        "_ws.expert.severity",
        "_ws.expert.group",
        "tcp.analysis.ack_lost_segment",
      ),
    ]);
    const nativeDiagnostics = verifiedFields
      .trimEnd()
      .split(/\r?\n/)
      .map((line) => line.split("\t"));
    expect(nativeDiagnostics.find((row) => row[0] === "5")?.[1]).toBe("1");
    expect(nativeDiagnostics.find((row) => row[0] === "7")?.[2]).toBe("1");
    expect(nativeDiagnostics.find((row) => row[0] === "10")?.[3]).toBe("1");
    expect(nativeDiagnostics.find((row) => row[0] === "13")?.[4]).toBe("0");
    const acknowledgedSegmentUnseen = nativeDiagnostics.filter((row) => row[9]).length;
    expect(outputs[6].traffic.summary).toMatchObject({
      tcpObservations: { retransmission: 1, previousSegmentUnseen: 1 },
      partialChecksumMarkers: { tcp: 1, udp: 0 },
      checksumStatuses: { tcp: { partial_offload_evidence: 1, unverified: 1 }, udp: { bad: 1 } },
    });
    expect(outputs[6].traffic.summary.tcpObservations.acknowledgedSegmentUnseen).toBe(
      acknowledgedSegmentUnseen || undefined,
    );
    for (const [index, key] of [
      [7, "expertSeverity"],
      [8, "expertGroup"],
    ] as const) {
      const histogram: Record<string, number> = {};
      for (const row of nativeDiagnostics)
        for (const code of row[index]?.split(",").filter(Boolean) ?? [])
          histogram[code] = (histogram[code] ?? 0) + 1;
      expect(outputs[6].traffic.summary[key]).toEqual(histogram);
    }
    expect(outputs[6].traffic.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ frames: [5], tcp: ["retransmission"] }),
        expect.objectContaining({ frames: [7], tcp: ["previousSegmentUnseen"] }),
        expect.objectContaining({ frames: [9], truncated: true, wireBytes: 68, capturedBytes: 56 }),
        expect.objectContaining({ frames: [10], checksum: { tcp: ["partial_offload_evidence"], udp: [] } }),
      ]),
    );
    expect(outputs[6].traffic.scopeCoverage).toMatchObject({
      truncatedFrames: 1,
      observationPoints: [
        { section: 1, interfaceId: 0, packets: 10 },
        { section: 1, interfaceId: 1, packets: 7 },
      ],
    });
    for (const [index, protocol, requestField] of [
      [7, "dns", "dns.response_to"],
      [8, "http", "http.request_in"],
    ] as const) {
      const output = await native(trafficSample, [
        "-Y",
        requestField,
        ...fields("frame.number", requestField, `${protocol}.time`),
      ]);
      const [response, request, durationSeconds] = output.trim().split("\t");
      expect(outputs[index].traffic.rows).toMatchObject([
        {
          frames: [Number(request), Number(response)],
          requestInScope: protocol === "dns",
          durationSeconds,
        },
      ]);
    }
    expect(outputs[7].traffic.summary).toMatchObject({ pairs: 1, requestsWithoutObservedResponse: 1 });
    expect(outputs[8].traffic.summary.pairsWithRequestOutsideScope).toBe(1);

    const tcpEvidence = outputs[9].traffic;
    expect(tcpEvidence.summary).toMatchObject({
      nativeGapRecords: 1,
      truncatedStreamFrames: 1,
      directions: [
        { direction: "a_to_b", payloadBytes: 23, missingBytes: 5 },
        { direction: "b_to_a", payloadBytes: 2 },
      ],
      tcp: {
        synFrame: 1,
        synAckFrame: 2,
        ackAfterSynAckFrame: 3,
        handshakeMarkersObserved: true,
        endMarkersObserved: false,
      },
    });
    expect(tcpEvidence.rows).toMatchObject([
      { frames: [4], kind: "data", direction: "a_to_b", payloadBytes: 19 },
      { frames: [8], kind: "gap", direction: "a_to_b", payloadBytes: 0, missingBytes: 5 },
    ]);
    expect(outputs.slice(14, 17).map(({ reason }) => reason)).toEqual([
      "stream_not_observed",
      "traffic_interval_limit",
      "traffic_window_required",
    ]);
    expect(outputs[17].coverage).toMatchObject({ scanComplete: false, scannedThrough: 5, matchedInScope: 2 });
    expect(session.outputs[18]?.ok).toBe(false);
    expect(outputs[19]).toMatchObject({ reason: "stream_not_found" });
    const proof = await native(trafficSample, ["-q", "-z", "follow,tcp,yaml,0"]);
    expect([...proof.matchAll(/packet: (\d+)/g)].map((match) => Number(match[1]))).toEqual([4, 8, 7, 9]);
    const marker = "VERA_LOCAL_SENTINEL";
    expect(proof).toContain(Buffer.from(marker).toString("base64"));
    expect(JSON.stringify(rig.modelResults)).not.toContain(marker);
    expect(JSON.stringify(rig.modelResults)).not.toContain(Buffer.from(marker).toString("base64"));
    expect(await readFile(join(rig.bench, trafficSource.path))).toEqual(await readFile(trafficSample));

    const continuation = {
      source: { reference: outputs[9].capture },
      limit: 2,
      trafficCursor: tcpEvidence.page.next,
    };
    await rig.writeReplay("trafficContinuation", [
      follow("tcp", 0, continuation),
      follow("tcp", 0, { ...continuation, window: { startMs: 0, endMs: 1000 } }),
      stat({ kind: "endpoints", layer: "tcp" }, { source: trafficSource }),
      stat(
        { kind: "response_timing", protocol: "http" },
        { source: trafficSource, filter: "frame.number == 14" },
      ),
      stat(
        { kind: "traffic", intervalMs: 50 },
        {
          source: untimedSource,
          filter: "frame.number >= 2",
          window: { startMs: 0, endMs: 100 },
        },
      ),
      stat({ kind: "protocol_hierarchy" }, { source: untimedSource }),
      { text: "Done." },
    ]);
    rig.resultBudget(8000, (text) => text.replaceAll("192.168.7.1", "[masked]"));
    rig.modelResults.length = 0;
    const cont = rig.session(service, "trafficContinuation", "ask");
    service.send(cont.id, "Continue the stream and list endpoints.");
    expect(await service.waitIdle(cont.id)).toEqual({ stopReason: "end" });
    const more = cont.outputs.map(({ summary }) => JSON.parse(summary));
    expect(more[0].traffic).toMatchObject({
      rows: [
        { frames: [7], direction: "a_to_b", payloadBytes: 4 },
        { frames: [9], direction: "b_to_a", payloadBytes: 2 },
      ],
      summary: { directions: tcpEvidence.summary.directions },
      page: { offset: 2, totalRows: 4, next: null },
    });
    expect(more[1]).toMatchObject({ reason: "cursor_mismatch" });
    expect(more[3].traffic).toMatchObject({
      summary: {
        pairs: 0,
        requests: 1,
        requestsWithoutObservedResponse: 0,
        requestsWithResponseOnlyOutsideScope: 1,
      },
      scopeCoverage: { measurementIncomplete: true },
    });
    const rawUntimed = (
      await native(
        untimedSample,
        fields(
          "frame.number",
          "frame.section_number",
          "frame.interface_id",
          "frame.time_epoch",
          "frame.time_relative",
        ),
      )
    )
      .trimEnd()
      .split(/\r?\n/)
      .map((line) => line.split("\t"));
    expect(rawUntimed[0]?.slice(3)).toEqual(["", ""]);
    expect(rawUntimed[1]?.[4]).toBe("0.000000000");
    expect(more[4].traffic).toMatchObject({
      timeOrigin: { basis: "first_timestamped_frame", frame: 2, timestampEpoch: rawUntimed[1]?.[3] },
      scopeCoverage: { framesWithoutTimestamp: 1, missingTimeFrames: 0, measurementIncomplete: true },
      rows: [
        { packets: 1, frames: [2] },
        { packets: 0, frames: [] },
      ],
    });
    const nativePoints = rawUntimed.map(([frame, section, interfaceId]) => ({
      section: Number(section),
      frame: { number: Number(frame), interfaceId: Number(interfaceId) },
    }));
    expect(more[5].traffic.evidence).toMatchObject([nativePoints[0], nativePoints[2]]);
    const model = rig.modelResults
      .map((text) => JSON.parse(text))
      .find((result) => result.traffic?.selection?.kind === "endpoints");
    expect(model.traffic.rows[0].endpoint.address).toBe("[masked]");
    expect(JSON.stringify(rig.modelResults)).not.toContain("192.168.7.1");
  } finally {
    await rig.close();
  }
}, 90_000);

it("answers questions about the sample capture without approvals and gates live capture", async (ctx) => {
  const file = "captures/sample.pcapng";
  const questions = [
    ["-n", "-r", file],
    [
      "-nr",
      file,
      "-Y",
      "coap",
      "-T",
      "fields",
      "-e",
      "frame.number",
      "-e",
      "coap.opt.uri_path_recon",
      "-e",
      "coap.code",
    ],
    [
      "-nr",
      file,
      "-Y",
      "modbus.func_code == 3",
      "-T",
      "fields",
      "-e",
      "mbtcp.trans_id",
      "-e",
      "modbus.regval_uint16",
    ],
    ["-nr", file, "-q", "-z", "io,phs"],
    ["-nr", file, "-q", "-z", "conv,udp"],
  ];
  const bench = await workbench({
    analyze: [
      ...questions.map(step),
      step(["-i", "1", "-c", "5"]),
      { text: "The board answered two CoAP reads and one Modbus read." },
    ],
    lua: [step(["-r", file, "-A", "user:secret"]), { text: "Refused." }],
  });
  try {
    // The installed skills carry the analysis and bounded-capture guidance without a tshark.
    const listed = (await bench.skills.list()).filter((skill) => skill.plugin === "wireshark-tshark");
    expect(listed.map((skill) => skill.name)).toEqual(["wireshark-analyze", "wireshark-capture"]);
    const analyze = (await bench.skills.read("plugin", "wireshark-analyze")).content;
    for (const text of [
      "`wireshark_capture`",
      "`discover`",
      "`query`",
      "`frame`",
      "`follow`",
      "scanFrom",
      "editcap",
      "lua_script",
      "`statistics`",
      "`conversations`",
      "`automotive`",
      "`network`",
    ])
      expect(analyze).toContain(text);
    const capture = (await bench.skills.read("plugin", "wireshark-capture")).content;
    for (const text of [
      "tshark -D",
      "-a duration:",
      "-c ",
      "-f ",
      "-w captures/",
      "background: true",
      "tcpdump",
    ])
      expect(capture).toContain(text);
    if (!bench.tshark) {
      ctx.skip("tshark is not installed on this host; the capture-file acceptance needs a real tshark");
      return;
    }
    const service = await bench.start();
    const analysis = bench.session(service, "analyze", "ask");
    const start = bench.starts.length;
    service.send(analysis.id, "What did the board answer in captures/sample.pcapng?");
    await expect.poll(analysis.pending, { timeout: 120_000 }).toBeDefined();
    const approval = analysis.pending();
    if (!approval) throw Error("Expected the live capture approval");
    expect(approval.program).toMatchObject({
      program: "tshark",
      risk: "device-read",
      args: ["-i", "1", "-c", "5"],
    });
    expect(service.get(analysis.id).snapshot.approvals).toHaveLength(1);
    expect(analysis.outputs).toHaveLength(questions.length);
    const answers = results(analysis.outputs);
    for (const answer of answers) expect(answer.exitCode, answer.output).toBe(0);
    expect(answers[0]?.output).toContain("/sensors/temp");
    expect(answers[1]?.output).toMatch(/3\t\/sensors\/temp\t1/);
    expect(answers[1]?.output).toMatch(/8\t\/sensors\/humidity\t69/);
    expect(answers[2]?.output).toContain("1\t235,258");
    expect(answers[3]?.output).toMatch(/coap\s+frames:4/);
    expect(answers[3]?.output).toMatch(/modbus\s+frames:2/);
    expect(answers[4]?.output).toContain("192.168.7.10:5683");
    expect(bench.starts.slice(start)).toHaveLength(questions.length);
    service.decideApproval({
      sessionId: analysis.id,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision: "denied",
    });
    expect(await service.waitIdle(analysis.id)).toEqual({ stopReason: "end" });
    // The denied live capture never started a process.
    expect(bench.starts.slice(start)).toHaveLength(questions.length);

    const blocked = bench.session(service, "lua", "bypass");
    const before = bench.starts.length;
    service.send(blocked.id, "Capture from the remote host with its password");
    expect(await service.waitIdle(blocked.id)).toEqual({ stopReason: "end" });
    expect(blocked.outputs.map((output) => output.ok)).toEqual([false]);
    expect(service.get(blocked.id).snapshot.approvals).toEqual([]);
    expect(bench.starts).toHaveLength(before);
  } finally {
    await bench.close();
  }
}, 240_000);

// Opt-in: VERA_TSHARK_LIVE_INTERFACE names a loopback interface (\Device\NPF_Loopback with Npcap, lo on
// Linux with dumpcap permissions). The test sends its own UDP datagrams to 127.0.0.1 and captures only them.
const live = process.env.VERA_TSHARK_LIVE_INTERFACE;
it.skipIf(!live)(
  "captures live loopback traffic after the device-read approval",
  async () => {
    const port = 59999;
    const capture = [
      "-n",
      "-i",
      live ?? "",
      "-f",
      `udp port ${port}`,
      "-c",
      "3",
      "-a",
      "duration:30",
      "-w",
      "captures/live.pcapng",
    ];
    const readBack = ["-nr", "captures/live.pcapng", "-T", "fields", "-e", "udp.dstport", "-e", "data.data"];
    const bench = await workbench({
      live: [step(capture), step(readBack), { text: "Captured three datagrams." }],
    });
    const socket = createSocket("udp4");
    try {
      if (!bench.tshark) throw Error("VERA_TSHARK_LIVE_INTERFACE needs an installed tshark");
      const service = await bench.start();
      const session = bench.session(service, "live", "ask");
      const before = bench.starts.length;
      service.send(session.id, "Capture three loopback datagrams.");
      await expect.poll(session.pending, { timeout: 60_000 }).toBeDefined();
      const approval = session.pending();
      if (!approval) throw Error("Expected the live capture approval");
      expect(approval.program).toMatchObject({ program: "tshark", risk: "device-read", args: capture });
      expect(bench.starts).toHaveLength(before);
      service.decideApproval({
        sessionId: session.id,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision: "approved",
      });
      // tshark needs a moment to open the interface; keep sending until the bounded capture ends.
      for (let index = 0; session.outputs.length === 0 && index < 120; index++) {
        socket.send(`vera-live-${index}`, port, "127.0.0.1");
        await sleep(250);
      }
      expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
      const [captured, read] = results(session.outputs);
      expect(captured?.exitCode, captured?.output).toBe(0);
      expect(captured?.output).toContain("3 packets captured");
      expect(read?.exitCode, read?.output).toBe(0);
      const lines = (read?.output ?? "").trim().split(/\r?\n/);
      expect(lines).toHaveLength(3);
      for (const line of lines)
        expect(line).toMatch(new RegExp(`^${port}\\t${Buffer.from("vera-live-").toString("hex")}`));
      if (evidence)
        await writeFile(
          join(evidence, `${process.platform}-tshark-live.json`),
          JSON.stringify({ approval: approval.program, outputs: session.outputs }, null, 2),
        );
    } finally {
      socket.close();
      await bench.close();
    }
  },
  180_000,
);

reportSkip(!live, "the live loopback capture test", "set VERA_TSHARK_LIVE_INTERFACE to a loopback interface");
