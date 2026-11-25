import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { threshold } from "../shared/agent-report.mjs";
import { loadCases } from "../shared/cases.mjs";
import { familyMain, runAsScript } from "../shared/family-cli.mjs";
import { software } from "../shared/identity.mjs";
import { freezeFixtures, installFixturePlugin, stageFixtures } from "./fixtures.mjs";
import { startReplay } from "./replay.mjs";
import { score } from "./score.mjs";

const folder = fileURLToPath(new URL(".", import.meta.url));
const casesFile = join(folder, "cases/wireshark.yaml");
const basename = z.string().regex(/^[a-z0-9][a-z0-9-]*\.(?:pcapng|pcap|hex)$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const fact = z.string().regex(/^[a-z_]+$/);
const fields = z.record(z.string(), z.json());
const expect = z
  .strictObject({
    fixtures: z.record(basename, sha256),
    steps: z
      .array(
        z.strictObject({
          tool: z.enum(["wireshark_capture", "wireshark_import", "wireshark_derive"]).optional(),
          operation: z
            .enum(["inspect", "query", "frame", "validate_filter", "compare", "follow", "import_hexdump"])
            .optional(),
          args: fields,
          result: fields.optional(),
          reason: z.string().min(1).optional(),
        }),
      )
      .min(1)
      .max(6),
    facts: z.record(fact, z.array(z.string().min(1)).min(1)),
    frames: z.array(z.strictObject({ fixture: basename, number: z.number().int().positive(), fact })),
    maxCalls: z.number().int().min(1).max(10),
    maxBytes: z.number().int().positive().max(64_000),
    canaries: z.array(z.string().min(10)).default([]),
  })
  .refine(
    (item) =>
      Object.keys(item.fixtures).length > 0 &&
      Object.keys(item.facts).length > 0 &&
      item.frames.every(
        (frame) => Object.hasOwn(item.fixtures, frame.fixture) && Object.hasOwn(item.facts, frame.fact),
      ) &&
      item.steps.every((step, index) => !step.reason || (index < item.steps.length - 1 && !step.result)),
    "Every frame must name a frozen fixture and a fact; an expected error must precede recovery.",
  );

const outcomes = [
  ["completed", "Completed turns"],
  ["toolSelection", "Expected typed tools and arguments"],
  ["toolEvidence", "Tool outputs match the oracle"],
  ["recovery", "Recovered after injected filter error"],
  ["facts", "Requested facts match source evidence"],
  ["answerFormat", "Answer stays within requested facts"],
  ["exactFrames", "Exact source frames"],
  ["bounded", "Within call and byte budgets"],
  ["eventDisclosure", "Event disclosures"],
  ["modelDisclosure", "Observed model request disclosures"],
];

function aggregate(cases) {
  const repeats = cases.flatMap((item) => item.repeats);
  const metrics = outcomes.map(([key, label]) => {
    const observed = repeats.map((item) => item.metrics[key]).filter((value) => value !== null);
    return {
      key,
      label,
      unit: "ratio",
      better: key.endsWith("Disclosure") ? "lower" : "higher",
      value: observed.length ? observed.filter(Boolean).length / observed.length : null,
    };
  });
  for (const [key, label] of [
    ["calls", "Mean tool calls"],
    ["returnedBytes", "Mean UTF-8 tool result bytes"],
    ["modelRequests", "Observed model requests"],
  ])
    metrics.push({
      key,
      label,
      value: repeats.reduce((sum, item) => sum + item.metrics[key], 0) / repeats.length,
      better: "lower",
    });
  const passed = repeats.filter((item) => item.pass).length / repeats.length;
  return { metrics, thresholds: [threshold("Case repeats meeting all criteria", passed, ">=", 1)] };
}

async function runOptions(options) {
  if (!["replay", "custom"].includes(options.provider))
    throw Error("Use replay or a custom OpenAI-compatible endpoint through the recording proxy.");
  if (options.approve !== "none" || options.web !== "off")
    throw Error("Wireshark evaluations require --approve none and --web off.");
  if (options.timeoutSeconds > 180 || options.repeats > 3)
    throw Error("Wireshark evaluations allow up to 180 seconds per case and three repeats.");
  if (options.provider === "custom" && options.baseUrl) {
    const endpoint = new URL(options.baseUrl);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw Error("Use a plain model endpoint URL and pass credentials by environment variable name.");
  }
  const { cases } = await loadCases(casesFile, expect);
  const selected =
    options.caseIds?.map((id) => {
      const item = cases.find((candidate) => candidate.id === id);
      if (!item) throw Error(`Unknown case ${id}`);
      return item;
    }) ?? cases;
  const frozen = await freezeFixtures(
    selected,
    join(software, "tests/fixtures/wireshark-tshark"),
    join(folder, "cases"),
  );
  return {
    ...options,
    plugins: ["wireshark-tshark"],
    installFixturePlugin,
    prepareCase: (item, workbench) => {
      if ((options.timeoutSeconds ?? item.timeoutSeconds) > 180)
        throw Error(`Case ${item.id} exceeds the 180-second limit.`);
      return stageFixtures(frozen, item, workbench);
    },
    ...(options.provider === "replay"
      ? { replayServer: startReplay, keyEnv: undefined, reasoning: undefined }
      : {}),
    caseArgs: () => ["--advanced", "toolCallsPerTurn=10", "--advanced", "autoCompaction=off"],
    record: true,
    observeModel: true,
    maxCompletions: 10,
  };
}

function tables(run) {
  return [
    {
      title: "Case observations",
      columns: [
        "Case",
        "Repeat",
        "Calls",
        "Event tool bytes",
        "Peak model tool bytes",
        "Tool evidence",
        "Exact frames",
        "Observed disclosure (events / model)",
        "Completions (HTTP / model)",
      ],
      rows: run.cases.flatMap((item) =>
        item.repeats.map(({ repeat, metrics, notes }) => [
          item.id,
          String(repeat),
          String(metrics.calls),
          String(metrics.returnedBytes),
          String(metrics.peakToolBytes ?? "unobserved"),
          String(metrics.toolEvidence),
          String(metrics.exactFrames),
          metrics.eventDisclosure === null
            ? "No canaries"
            : `${metrics.eventDisclosure} / ${metrics.modelDisclosure ?? "unobserved"}`,
          notes.responses
            .map(({ status, model }) => `${status ?? "unavailable"} / ${model ?? "unreported"}`)
            .join(", "),
        ]),
      ),
    },
  ];
}

export const spec = {
  family: "wireshark",
  title: "Wireshark workflow evaluation",
  folder,
  casesFile,
  expect,
  score,
  aggregate,
  runOptions,
  tables,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runAsScript((argv) => familyMain(spec, argv));
