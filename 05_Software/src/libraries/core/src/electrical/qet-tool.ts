// The QElectroTech tools (spec REQ-DATA-963cbdf6 "Tools"): qelectrotech reads a .qet project in bounded views and
// reconciles it with the model; qelectrotech_change writes a template candidate (new file) or splices element
// information into an existing project (base sha256) through the write flow; qelectrotech_check stores one result.
// The model is never written here: reconcile returns electrical_model_change operations.
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { type ElectricalResult, electricalModelPath, electricalResultsDir } from "@vera/shared";
import { z } from "zod";
import { assertAgentWritable, commitChange, type PreparedChange } from "../tools/changes.js";
import type { ToolContext, ToolDefinition } from "../tools/context.js";
import { toolPathGuard } from "../tools/context.js";
import { PathGuard } from "../workbench/path-guard.js";
import { normalUuid, type QetProject, readQetProject, terminalKey } from "./qet.js";
import { assemblyChecks, projectChecks, type QetCheck } from "./qet-check.js";
import { qetTemplateMethods, renderTemplate } from "./qet-templates.js";
import { newRun, prepareResultChange } from "./result-change.js";
import { resultFreshness } from "./results.js";
import { fileDiff, readModelFile, readResultFile } from "./tools.js";
import { decodeXmlBytes, escapeAttribute, escapeText, xmlLimits } from "./xml-strict.js";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const qetPath = z
  .string()
  .min(5)
  .max(160)
  .regex(/\.qet$/i, "must be a .qet file");
const runId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const PAGE_DEVICES = 100;
const PAGE_POTENTIALS = 200;
export const qetInfoNames = [
  "label",
  "comment",
  "function",
  "description",
  "designation",
  "manufacturer",
  "manufacturer_reference",
  "supplier",
  "quantity",
  "unity",
  "plant",
  "location",
] as const;

export interface QetFile {
  path: string;
  bytes: Buffer;
  sha256: string;
  project: QetProject;
}
/** Reads a .qet file strictly, confined to the workbench; throws when it is missing, too large or invalid. */
export async function readQetFile(root: string, path: string): Promise<QetFile> {
  const target = await (await PathGuard.create(root)).resolve(qetPath.parse(path));
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(target.absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw Error(`The QElectroTech project ${target.relative} does not exist.`);
    throw error;
  }
  if (!info.isFile()) throw Error(`The QElectroTech project ${target.relative} is not an ordinary file.`);
  if (info.size > xmlLimits.chars)
    throw Error(`The QElectroTech project ${target.relative} is larger than 16 MiB.`);
  const bytes = await readFile(target.absolute);
  const project = readQetProject(decodeXmlBytes(bytes, target.relative), target.relative);
  return { path: target.relative, bytes, sha256: hash(bytes), project };
}

const position = (project: QetProject, uuid: string) => project.byUuid.get(uuid)?.position ?? "?";
function projectSummary(file: QetFile) {
  const { project } = file;
  return {
    path: file.path,
    sha256: file.sha256,
    bytes: file.bytes.length,
    version: project.version,
    title: project.title,
    folios: project.folios.map((f) => ({
      order: f.order,
      title: f.title,
      elements: f.elements,
      conductors: f.conductors,
    })),
    definitions: project.definitions.size,
    elements: project.elements.length,
    conductors: project.conductors.length,
    potentials: project.potentials.length,
    devices: project.devices.length,
    problems: project.problems.slice(0, 100),
    ...(project.problems.length > 100 ? { problemsTruncated: true } : {}),
  };
}

export const qelectrotechParams = z.strictObject({
  view: z.enum(["project", "devices", "potentials", "reconcile"]),
  path: qetPath,
  offset: z.number().int().nonnegative().optional(),
});
async function readView(ctx: ToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const args = qelectrotechParams.parse(raw);
  const file = await readQetFile(ctx.root, args.path);
  const { project } = file;
  const offset = args.offset ?? 0;
  if (args.view === "project") return projectSummary(file);
  if (args.view === "devices") {
    const page = project.devices.slice(offset, offset + PAGE_DEVICES);
    return {
      sha256: file.sha256,
      total: project.devices.length,
      offset,
      devices: page.map((device) => ({
        label: device.label,
        definition: device.head.definition?.name ?? device.head.type,
        members: device.members.map((m) => ({
          uuid: m.uuid,
          role: m.definition?.linkType ?? "unknown",
          kind: m.definition?.kind.type,
          state: m.definition?.kind.state,
          folio: m.folio + 1,
          position: m.position,
          info: Object.fromEntries(Object.entries(m.info).filter(([, v]) => v.trim() !== "")),
        })),
      })),
      ...(offset + page.length < project.devices.length ? { next: offset + page.length } : {}),
    };
  }
  if (args.view === "potentials") {
    const page = project.potentials.slice(offset, offset + PAGE_POTENTIALS);
    return {
      sha256: file.sha256,
      total: project.potentials.length,
      offset,
      potentials: page.map((p) => ({
        id: p.id,
        numbers: p.numbers,
        terminals: p.terminals.map((end) => {
          const element = project.byUuid.get(end.element);
          const name = element?.definition?.terminals[end.terminal]?.name || `#${end.terminal}`;
          return `${element?.label ?? element?.definition?.name ?? end.element}:${name}@${position(project, end.element)}`;
        }),
      })),
      ...(offset + page.length < project.potentials.length ? { next: offset + page.length } : {}),
    };
  }
  const model = await readModelFile(ctx.root);
  const { reconciled } = projectChecks(project, model?.model ?? null, file.path);
  return { sha256: file.sha256, modelSha256: model?.sha256 ?? null, ...reconciled };
}

export const qelectrotechTool: ToolDefinition = {
  name: "qelectrotech",
  class: "read",
  description:
    "Read a QElectroTech .qet project in the workbench (strict XML, no DTD). view project: version, folios, counts, problems; devices: devices (coil/master with its linked contacts) with folio positions and information; potentials: terminals joined by conductors and folio reports with conductor numbers; reconcile: device labels against the electrical model's refs and QET UUIDs, with electrical_model_change operations to record them (never applied here).",
  params: qelectrotechParams,
  execute: (ctx, args, signal) => {
    signal.throwIfAborted();
    return readView(ctx, args);
  },
};

/** Splices element information and the project title into the source; every other byte stays as it is. */
export function spliceEdits(
  project: QetProject,
  edit: { title?: string | undefined; elements: { uuid: string; info: Record<string, string> }[] },
): string {
  const { source } = project;
  const splices: { start: number; end: number; text: string }[] = [];
  if (edit.title !== undefined) {
    const title = project.root.attributes.find((a) => a.name === "title");
    if (title)
      splices.push({ start: title.valueStart, end: title.valueEnd, text: escapeAttribute(edit.title) });
    else {
      const at = project.root.start + "<project".length;
      splices.push({ start: at, end: at, text: ` title="${escapeAttribute(edit.title)}"` });
    }
  }
  // New lines follow the file's own line ending, so a CRLF project stays CRLF.
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const named = new Set<string>();
  for (const entry of edit.elements) {
    if (named.has(normalUuid(entry.uuid)))
      throw Error(`The element ${entry.uuid} is named twice: put all its information in one entry.`);
    named.add(normalUuid(entry.uuid));
    const element = project.byUuid.get(normalUuid(entry.uuid));
    if (!element) throw Error(`The project has no element ${entry.uuid}.`);
    const list = element.node.children.find((child) => child.name === "elementInformations");
    if (!list) throw Error(`The element ${element.uuid} has no elementInformations list to edit.`);
    const added: string[] = [];
    for (const [name, value] of Object.entries(entry.info)) {
      if (!(qetInfoNames as readonly string[]).includes(name))
        throw Error(`The information ${name} cannot be edited (allowed: ${qetInfoNames.join(", ")}).`);
      const existing = list.children.find(
        (child) =>
          child.name === "elementInformation" &&
          child.attributes.some((a) => a.name === "name" && a.value === name),
      );
      if (!existing) {
        added.push(`<elementInformation name="${name}" show="1">${escapeText(value)}</elementInformation>`);
        continue;
      }
      if (existing.selfClosing)
        splices.push({
          start: existing.end - 2,
          end: existing.end,
          text: `>${escapeText(value)}</elementInformation>`,
        });
      else splices.push({ start: existing.contentStart, end: existing.contentEnd, text: escapeText(value) });
    }
    if (!added.length) continue;
    const lineStart = source.lastIndexOf("\n", list.start) + 1;
    const indent = /^[ \t]*/.exec(source.slice(lineStart, list.start))?.[0] ?? "";
    const inner = added.map((text) => `${eol}${indent}    ${text}`).join("");
    if (list.selfClosing)
      splices.push({
        start: list.start,
        end: list.end,
        text: `<elementInformations>${inner}${eol}${indent}</elementInformations>`,
      });
    else {
      let at = list.contentEnd;
      while (at > list.contentStart && /[ \t\r\n]/.test(source[at - 1] as string)) at--;
      splices.push({ start: at, end: at, text: inner });
    }
  }
  splices.sort((a, b) => b.start - a.start);
  for (let i = 1; i < splices.length; i++)
    if ((splices[i] as { end: number }).end > (splices[i - 1] as { start: number }).start)
      throw Error("Two edits touch the same information.");
  let out = source;
  for (const splice of splices) out = out.slice(0, splice.start) + splice.text + out.slice(splice.end);
  return out;
}

const infoEdits = z
  .array(z.strictObject({ uuid: z.string().min(1).max(64), info: z.record(z.string(), z.string().max(200)) }))
  .max(100);
/** One object schema for the model's tool spec; the request below checks the fields of each action. */
export const qelectrotechChangeParams = z.strictObject({
  action: z.enum(["candidate", "edit"]),
  path: qetPath,
  motorDrivesRun: runId.optional(),
  motor: z.string().min(1).max(64).optional(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  title: z.string().min(1).max(120).optional(),
  elements: infoEdits.optional(),
});
const qelectrotechChangeRequest = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("candidate"),
    motorDrivesRun: runId,
    motor: z.string().min(1).max(64),
    path: qetPath,
    title: z.string().min(1).max(120).optional(),
  }),
  z.strictObject({
    action: z.literal("edit"),
    path: qetPath,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    title: z.string().min(1).max(120).optional(),
    elements: infoEdits.default([]),
  }),
]);

/** The assembly of a current motor_drives result for one motor, with the stored mechanical-interlock criterion. */
async function assemblyOf(ctx: ToolContext, run: string, motorId: string) {
  const file = await readModelFile(ctx.root);
  if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
  const result = await readResultFile(ctx.root, run);
  if (result.producer.plugin !== "motor-drives")
    throw Error(`The result ${run} was not produced by motor-drives.`);
  const fresh = resultFreshness(result, file.model);
  if (fresh.freshness !== "current")
    throw Error(
      `The motor-drives result ${run} is ${fresh.freshness}${fresh.freshness === "stale" ? ` (changed: ${fresh.changed.join(", ") || "none"}; removed: ${fresh.removed.join(", ") || "none"})` : ""}: run motor_drives again.`,
    );
  const assembly = result.assemblies?.find((entry) => entry.motor === motorId);
  if (!assembly) throw Error(`The motor-drives result ${run} holds no assembly for ${motorId}.`);
  if (!(qetTemplateMethods as readonly string[]).includes(assembly.method))
    throw Error(
      `No QElectroTech template for the ${assembly.method} method of ${motorId} (templates: ${qetTemplateMethods.join(", ")}).`,
    );
  const motor = file.model.objects.find((object) => object.id === motorId);
  const stored = result.criteria.find(
    (c) => c.subject === motorId && c.id.startsWith("mechanical-interlock"),
  );
  return {
    model: file,
    result,
    assembly,
    motorRef: motor?.ref ?? "M1",
    mechanical: stored ? { verdict: stored.verdict, ...(stored.note ? { note: stored.note } : {}) } : null,
  };
}
const failing = (checks: QetCheck[]) =>
  checks.filter((c) => c.id !== "mechanical-interlock" && c.verdict !== "pass");

/** Prepares a candidate (new file) or an edit (base sha256); nothing is written before the change is applied. */
export async function prepareQelectrotechChange(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const args = qelectrotechChangeRequest.parse(qelectrotechChangeParams.parse(raw));
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const inside = await (await PathGuard.create(ctx.root)).resolve(args.path);
  const target = await (await toolPathGuard(ctx)).resolve(args.path);
  if (target.key !== inside.key) throw Error("The QElectroTech project must be inside the workbench.");
  await assertAgentWritable(ctx, target);
  let before: Buffer | null = null;
  let output: string;
  let checks: QetCheck[] = [];
  if (args.action === "candidate") {
    const exists = await lstat(inside.absolute).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (exists) throw Error(`${inside.relative} already exists: a candidate is always a new file.`);
    const { assembly, motorRef, mechanical } = await assemblyOf(ctx, args.motorDrivesRun, args.motor);
    output = renderTemplate({
      assembly,
      motorRef,
      title: args.title ?? `${motorRef} ${assembly.method} starter`,
    });
    const project = readQetProject(output, inside.relative);
    checks = assemblyChecks(project, assembly, motorRef, mechanical);
    const bad = failing(checks);
    if (project.problems.length || bad.length)
      throw Error(
        `The ${assembly.method} candidate fails its checks: ${[...project.problems.map((p) => p.code), ...bad.map((c) => `${c.id} (${c.note})`)].join("; ")}.`,
      );
  } else {
    const file = await readQetFile(ctx.root, args.path);
    if (file.sha256 !== args.sha256)
      throw Error(
        `${file.path} changed: its sha256 is ${file.sha256}, not the base ${args.sha256}. Read it again.`,
      );
    before = file.bytes;
    output = spliceEdits(file.project, args);
    if (output === file.project.source) throw Error("The edit leaves the project unchanged.");
    const after = readQetProject(output, file.path);
    const ids = (p: QetProject) => p.elements.map((e) => e.uuid).join();
    const ends = (p: QetProject) =>
      p.conductors.map((c) => c.ends.map((e) => (e ? terminalKey(e) : "-")).join()).join();
    if (ids(after) !== ids(file.project) || ends(after) !== ends(file.project))
      throw Error("The edit would change elements or conductors; nothing is prepared.");
  }
  signal.throwIfAborted();
  const after = Buffer.from(output, "utf8");
  if (after.length > xmlLimits.chars) throw Error("The project would be larger than 16 MiB.");
  const beforeSha256 = before === null ? null : hash(before);
  const afterSha256 = hash(after);
  const { diff, added, removed } = fileDiff(inside.relative, before?.toString("utf8") ?? "", output);
  const summary = checks.map((c) => ({ id: c.id, verdict: c.verdict }));
  const request = Object.freeze({
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    tool: "qelectrotech_change" as const,
    path: inside.relative,
    args: Object.freeze({ ...args }),
    existed: before !== null,
    beforeSha256,
    afterSha256,
    diff,
    bytes: after.length,
    protected: false,
  });
  return Object.freeze({
    request,
    apply: commitChange({
      ctx,
      signal,
      target,
      path: args.path,
      before,
      beforeSha256,
      after,
      afterSha256,
      changePath: inside.relative,
      diff,
      added,
      removed,
      result: { path: inside.relative, sha256: afterSha256, bytes: after.length, checks: summary },
    }),
  });
}

export const qelectrotechChangeTool: ToolDefinition = {
  name: "qelectrotech_change",
  class: "write",
  description:
    "Write a QElectroTech project. action candidate: a new .qet from the DOL, reversing or star-delta template for one motor of a CURRENT motor_drives result (its assembly's tags, order codes, connections and interlocks), checked from the written XML before preview; action edit: change element information (label, comment, manufacturer_reference, ...) by element UUID and the title of an existing .qet with its base sha256, every other byte kept. Needs approval; fails if the file changed meanwhile.",
  params: qelectrotechChangeParams,
  prepare: (ctx, args, signal) => prepareQelectrotechChange(ctx, args, signal),
  execute: async (ctx, args, signal) => (await prepareQelectrotechChange(ctx, args, signal)).apply(signal),
};

export const qelectrotechCheckParams = z.strictObject({
  path: qetPath,
  motorDrivesRun: runId.optional(),
  motor: z.string().min(1).max(64).optional(),
});
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Checks the project against the model (and optionally an assembly) and prepares one new result file. */
export async function prepareQelectrotechCheck(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const args = qelectrotechCheckParams.parse(raw);
  if ((args.motorDrivesRun === undefined) !== (args.motor === undefined))
    throw Error("motorDrivesRun and motor go together: name both or neither.");
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const model = await readModelFile(ctx.root);
  if (!model)
    throw Error(
      `The workbench has no electrical model (${electricalModelPath}); the check compares the project with it.`,
    );
  const file = await readQetFile(ctx.root, args.path);
  const { project } = file;
  const { checks, reconciled } = projectChecks(project, model.model, file.path);
  const inputs: ElectricalResult["inputs"] = [
    { id: model.model.project.id, snapshot: model.model.project as never },
  ];
  for (const match of reconciled.matched) {
    const object = model.model.objects.find((o) => o.id === match.object);
    if (object && !inputs.some((entry) => entry.id === object.id))
      inputs.push({ id: object.id, snapshot: object as never });
  }
  // The hash must survive: only the path part is shortened.
  const sources = [`qet:${clip(file.path, 120)}@sha256:${file.sha256}`];
  let subject: string | undefined;
  if (args.motorDrivesRun && args.motor) {
    const found = await assemblyOf(ctx, args.motorDrivesRun, args.motor);
    checks.push(...assemblyChecks(project, found.assembly, found.motorRef, found.mechanical));
    for (const input of found.result.inputs)
      if (!inputs.some((entry) => entry.id === input.id)) inputs.push(input);
    sources.push(`motor_drives:${electricalResultsDir}/${args.motorDrivesRun}`);
    subject = args.motor;
  }
  signal.throwIfAborted();
  const { runId: run, now } = newRun();
  const count = (name: string, value: number) => ({ name, value, unit: "1" });
  const result: ElectricalResult = {
    kind: "vera-electrical-result",
    format: 1,
    runId: run,
    producer: {
      plugin: "qelectrotech",
      operation: "check",
      engine: { name: "vera-qet-check", version: "1.0.0" },
    },
    method: {
      id: "qet-check-1",
      title: "QElectroTech project check: numbering, cross-references, device list",
      reference: "QElectroTech .qet project format as written by QET 0.80 to 0.100",
    },
    status: "completed",
    preliminary: true,
    startedAt: now,
    finishedAt: now,
    model: { path: electricalModelPath, sha256: model.sha256 },
    catalog: null,
    inputs: inputs.slice(0, 1000),
    assumptions: [
      "Devices are matched to the model by visible reference (label = ref); the QET element UUID is the identity recorded in attributes.qetUuid.",
      "An electrical interlock passes only when every path from the control supply to the coil passes the other device's NC contact; a mechanical interlock is taken from the motor_drives result, never from the drawing.",
    ],
    sources,
    conditions: {
      qetFile: { text: clip(file.path, 200) },
      qetSha256: { text: file.sha256 },
      qetVersion: { text: project.version ?? "unknown" },
    },
    intermediate: [
      count("folios", project.folios.length),
      count("elements", project.elements.length),
      count("conductors", project.conductors.length),
      count("potentials", project.potentials.length),
      count("devices", project.devices.length),
    ],
    criteria: checks.slice(0, 200).map((c) => ({
      id: clip(c.id, 200),
      title: clip(c.title, 200),
      ...(subject &&
      !["project-read", "labels", "conductor-numbering", "cross-references", "device-list"].includes(c.id)
        ? { subject }
        : {}),
      verdict: c.verdict,
      note: clip(c.note, 1000),
    })),
    limits: [
      "No electrical calculation: the check covers the drawing's structure, numbering and cross-references, not ratings.",
      "The project file's freshness is not tracked: the result names its sha256; a changed file needs a new check.",
      "A visual inspection in QElectroTech is still the engineer's.",
    ],
    messages: [
      ...project.problems.map((p) => clip(p.message, 1000)),
      ...reconciled.problems.map((p) => clip(p, 1000)),
    ].slice(0, 200),
  };
  return prepareResultChange({
    ctx,
    signal,
    tool: "qelectrotech_check",
    args: { ...args },
    result,
    model: model.model,
    label: "QElectroTech check",
  });
}

export const qelectrotechCheckTool: ToolDefinition = {
  name: "qelectrotech_check",
  class: "write",
  description:
    "Check a QElectroTech .qet project and store a new electrical result: labels, conductor numbering (one number per potential), cross-references, device list against the model (refs and QET UUIDs) and, with motorDrivesRun + motor, the candidate checks against that CURRENT assembly (phase connections, interlocks as NC contacts on every coil path). The result names the file's sha256. Needs approval; changes no project and no model.",
  params: qelectrotechCheckParams,
  prepare: (ctx, args, signal) => prepareQelectrotechCheck(ctx, args, signal),
  execute: async (ctx, args, signal) => (await prepareQelectrotechCheck(ctx, args, signal)).apply(signal),
};
