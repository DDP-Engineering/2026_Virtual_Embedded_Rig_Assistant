import { z } from "zod";
import { artifactContentSchema, artifactIdSchema, artifactSummarySchema } from "./artifacts.js";
import { changeDetailSchema, changeIdSchema, changeSummarySchema } from "./changes.js";
import { chatgptLoginSchema, chatgptStatusSchema } from "./chatgpt.js";
import {
  docsScopeSchema,
  documentOpenSchema,
  documentSchema,
  documentSearchHitSchema,
  viewerContentSchema,
} from "./documents.js";
import { type VeraError, veraErrorSchema } from "./errors.js";
import { providerDiscoveryRequestSchema, providerDiscoverySchema } from "./provider-discovery.js";
import {
  modelReferenceSchema,
  providerCatalogSchema,
  providerListSchema,
  providerModelsRequestSchema,
  providerRemoveSchema,
  providerSaveResultSchema,
  providerSaveSchema,
  providerTestRequestSchema,
  providerTestResultSchema,
} from "./providers.js";
import { permissionModeSchema, sessionIdSchema, sessionSummarySchema } from "./session.js";
import { sessionExportFormatSchema, sessionSearchQuerySchema } from "./session-export.js";
import { sessionStateSchema } from "./session-state.js";
import { recentWorkbenchStateSchema, settingsPatchSchema, settingsSnapshotSchema } from "./settings.js";
import {
  SKILL_BYTES,
  skillContentSchema,
  skillNameSchema,
  skillSummarySchema,
  skillsScopeSchema,
  skillTargetSchema,
} from "./skills.js";
import { updateSnapshotSchema } from "./updates.js";
import {
  configSnapshotSchema,
  pinnedSchema,
  workbenchIdSchema,
  workbenchPatchSchema,
  workbenchSnapshotSchema,
} from "./workbench.js";

export function defineChannel<const Name extends string, Req extends z.ZodType, Res extends z.ZodType>(
  name: Name,
  request: Req,
  response: Res,
) {
  return { name, request, response } as const;
}

export { type VeraError, veraError, veraErrorSchema } from "./errors.js";
export const appInfoSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  portable: z.boolean(),
  locale: z.string().min(1),
  testBuild: z.boolean(),
  signing: z.enum(["signed", "unsigned", "not-applicable"]),
});
export const channels = {
  "window.menu": defineChannel(
    "window.menu",
    z.strictObject({
      menu: z.enum(["file", "edit", "view", "help"]),
      x: z.number().int().min(0).max(32767),
      y: z.number().int().min(0).max(32767),
    }),
    z.strictObject({}),
  ),
  "update.get": defineChannel("update.get", z.strictObject({}), updateSnapshotSchema),
  "update.check": defineChannel("update.check", z.strictObject({}), updateSnapshotSchema),
  "update.download": defineChannel(
    "update.download",
    z.strictObject({ confirmed: z.literal(true) }),
    updateSnapshotSchema,
  ),
  "update.restart": defineChannel("update.restart", z.strictObject({}), updateSnapshotSchema),
  "update.openRelease": defineChannel(
    "update.openRelease",
    z.strictObject({ confirmed: z.literal(true), version: z.string().min(1).max(128) }),
    updateSnapshotSchema,
  ),
  "skills.list": defineChannel("skills.list", skillsScopeSchema, z.array(skillSummarySchema).max(2048)),
  "skills.open": defineChannel("skills.open", skillTargetSchema, skillContentSchema),
  "skills.create": defineChannel(
    "skills.create",
    skillTargetSchema.extend({ name: skillNameSchema }),
    skillContentSchema,
  ),
  "skills.save": defineChannel(
    "skills.save",
    skillTargetSchema.extend({
      content: z.string().max(SKILL_BYTES),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
    skillContentSchema,
  ),
  "skills.toggle": defineChannel(
    "skills.toggle",
    skillsScopeSchema.extend({ name: z.string().min(1).max(255), enabled: z.boolean() }),
    z.strictObject({}),
  ),
  "docs.list": defineChannel(
    "docs.list",
    docsScopeSchema,
    docsScopeSchema.extend({ documents: z.array(documentSchema) }),
  ),
  "docs.search": defineChannel(
    "docs.search",
    docsScopeSchema.extend({ query: z.string().trim().min(1).max(1000) }),
    docsScopeSchema.extend({ results: z.array(documentSearchHitSchema).max(20) }),
  ),
  "docs.open": defineChannel(
    "docs.open",
    documentOpenSchema,
    docsScopeSchema.extend({ content: viewerContentSchema }),
  ),
  "docs.reindex": defineChannel("docs.reindex", docsScopeSchema.partial(), z.strictObject({})),
  "app.openExternal": defineChannel(
    "app.openExternal",
    z.strictObject({ url: z.url({ protocol: /^https?$/ }).max(16384), confirmed: z.literal(true) }),
    z.strictObject({}),
  ),
  "providers.chatgpt.login": defineChannel(
    "providers.chatgpt.login",
    chatgptLoginSchema,
    chatgptStatusSchema,
  ),
  "providers.chatgpt.status": defineChannel(
    "providers.chatgpt.status",
    z.strictObject({}),
    chatgptStatusSchema,
  ),
  "providers.chatgpt.cancel": defineChannel(
    "providers.chatgpt.cancel",
    z.strictObject({}),
    z.strictObject({}),
  ),
  "providers.chatgpt.logout": defineChannel(
    "providers.chatgpt.logout",
    z.strictObject({}),
    z.strictObject({}),
  ),
  "artifacts.list": defineChannel(
    "artifacts.list",
    z.strictObject({ sessionId: sessionIdSchema }),
    z.array(artifactSummarySchema),
  ),
  "artifacts.open": defineChannel(
    "artifacts.open",
    z.strictObject({ artifactId: artifactIdSchema }),
    artifactContentSchema,
  ),
  "artifacts.reveal": defineChannel(
    "artifacts.reveal",
    z.strictObject({ artifactId: artifactIdSchema }),
    z.strictObject({}),
  ),
  "artifacts.export": defineChannel(
    "artifacts.export",
    z.strictObject({ artifactId: artifactIdSchema }),
    z.strictObject({ exported: z.boolean() }),
  ),
  "changes.list": defineChannel(
    "changes.list",
    z.strictObject({ sessionId: sessionIdSchema }),
    z.array(changeSummarySchema),
  ),
  "changes.get": defineChannel(
    "changes.get",
    z.strictObject({ changeId: changeIdSchema }),
    changeDetailSchema,
  ),
  "app.revealPath": defineChannel(
    "app.revealPath",
    z.strictObject({ path: z.string().min(1) }),
    z.strictObject({}),
  ),
  "session.approval.decide": defineChannel(
    "session.approval.decide",
    z
      .strictObject({
        sessionId: sessionIdSchema,
        approvalId: z.string().regex(/^apv_[0-9A-HJKMNP-TV-Z]{26}$/),
        requestSha256: z.string().regex(/^[0-9a-f]{64}$/),
        decision: z.enum(["approved", "denied"]),
        switchToAutoEdit: z.boolean().optional(),
      })
      .refine((v) => !v.switchToAutoEdit || v.decision === "approved"),
    z.strictObject({}),
  ),
  "session.list": defineChannel(
    "session.list",
    z.strictObject({ workbenchId: workbenchIdSchema.optional() }),
    z.array(sessionSummarySchema),
  ),
  "session.search": defineChannel(
    "session.search",
    z.strictObject({ query: sessionSearchQuerySchema, workbenchId: workbenchIdSchema.optional() }),
    z.array(sessionSummarySchema),
  ),
  "session.export": defineChannel(
    "session.export",
    z.strictObject({ sessionId: sessionIdSchema, format: sessionExportFormatSchema }),
    z.strictObject({ exported: z.boolean() }),
  ),
  "session.create": defineChannel(
    "session.create",
    z.strictObject({
      workbenchId: workbenchIdSchema.optional(),
      modelRef: modelReferenceSchema.nullable().optional(),
      mode: permissionModeSchema.optional(),
    }),
    sessionSummarySchema,
  ),
  "session.get": defineChannel(
    "session.get",
    z.strictObject({ sessionId: sessionIdSchema }),
    z.strictObject({
      snapshot: sessionStateSchema,
      seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }),
  ),
  "session.rename": defineChannel(
    "session.rename",
    z.strictObject({ sessionId: sessionIdSchema, title: z.string().trim().min(1).max(60) }),
    sessionSummarySchema,
  ),
  "session.archive.set": defineChannel(
    "session.archive.set",
    z.strictObject({ sessionId: sessionIdSchema, archived: z.boolean() }),
    sessionSummarySchema,
  ),
  "session.delete": defineChannel(
    "session.delete",
    z.strictObject({ sessionId: sessionIdSchema }),
    z.strictObject({}),
  ),
  "session.send": defineChannel(
    "session.send",
    z.strictObject({
      sessionId: sessionIdSchema,
      text: z.string().refine((value) => value.trim().length > 0),
    }),
    z.strictObject({ turnId: z.string().min(1), messageId: z.string().min(1) }),
  ),
  "session.stop": defineChannel(
    "session.stop",
    z.strictObject({ sessionId: sessionIdSchema }),
    z.strictObject({ stopped: z.boolean() }),
  ),
  "session.model.set": defineChannel(
    "session.model.set",
    z.strictObject({ sessionId: sessionIdSchema, modelRef: modelReferenceSchema.nullable() }),
    sessionSummarySchema,
  ),
  "session.mode.set": defineChannel(
    "session.mode.set",
    z.strictObject({ sessionId: sessionIdSchema, mode: permissionModeSchema }),
    sessionSummarySchema,
  ),
  "providers.discover": defineChannel(
    "providers.discover",
    providerDiscoveryRequestSchema,
    providerDiscoverySchema,
  ),
  "providers.models": defineChannel("providers.models", providerModelsRequestSchema, providerCatalogSchema),
  "providers.test": defineChannel("providers.test", providerTestRequestSchema, providerTestResultSchema),
  "providers.list": defineChannel("providers.list", z.strictObject({}), providerListSchema),
  "providers.save": defineChannel("providers.save", providerSaveSchema, providerSaveResultSchema),
  "providers.remove": defineChannel("providers.remove", providerRemoveSchema, z.strictObject({})),
  "app.info": defineChannel("app.info", z.strictObject({}), appInfoSchema),
  "app.settings.get": defineChannel("app.settings.get", z.strictObject({}), settingsSnapshotSchema),
  "app.settings.update": defineChannel("app.settings.update", settingsPatchSchema, settingsSnapshotSchema),
  "app.chooseFolder": defineChannel(
    "app.chooseFolder",
    z.strictObject({}),
    z.strictObject({ folder: z.string().min(1).nullable() }),
  ),
  "workbench.create": defineChannel(
    "workbench.create",
    z.strictObject({ folder: z.string().min(1), name: z.string().trim().min(1).max(80) }),
    workbenchSnapshotSchema,
  ),
  "workbench.open": defineChannel(
    "workbench.open",
    z.strictObject({ folder: z.string().min(1) }),
    workbenchSnapshotSchema,
  ),
  "workbench.close": defineChannel("workbench.close", z.strictObject({}), z.strictObject({})),
  "workbench.recent": defineChannel(
    "workbench.recent",
    z.strictObject({
      remove: z.string().min(1).optional(),
      pin: z.strictObject({ folder: z.string().min(1), value: z.boolean() }).optional(),
      reveal: z.string().min(1).optional(),
    }),
    z.array(recentWorkbenchStateSchema),
  ),
  "workbench.config.get": defineChannel(
    "workbench.config.get",
    z.strictObject({}),
    configSnapshotSchema.extend({ readOnly: z.boolean().optional(), folder: z.string().min(1).optional() }),
  ),
  "workbench.config.update": defineChannel(
    "workbench.config.update",
    z.strictObject({ patch: workbenchPatchSchema, workbenchId: workbenchIdSchema.optional() }),
    configSnapshotSchema,
  ),
  "workbench.pinned.get": defineChannel("workbench.pinned.get", z.strictObject({}), pinnedSchema),
  "workbench.pinned.update": defineChannel(
    "workbench.pinned.update",
    z.strictObject({ content: z.string(), workbenchId: workbenchIdSchema.optional() }),
    pinnedSchema,
  ),
  "workbench.files": defineChannel(
    "workbench.files",
    z.strictObject({ query: z.string().max(1024) }),
    z.array(z.string().min(1)).max(50),
  ),
} as const;
export type Channel = keyof typeof channels;
export type Request<C extends Channel> = z.input<(typeof channels)[C]["request"]>;
export type Response<C extends Channel> = z.output<(typeof channels)[C]["response"]>;
export type AppInfo = Response<"app.info">;
export type InvokeResult<C extends Channel> =
  | { ok: true; value: Response<C> }
  | { ok: false; error: VeraError };

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && Object.hasOwn(channels, value);
}
export function resultSchema<C extends Channel>(channel: C): z.ZodType<InvokeResult<C>> {
  return z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), value: channels[channel].response }),
    z.strictObject({ ok: z.literal(false), error: veraErrorSchema }),
  ]) as z.ZodType<InvokeResult<C>>;
}
