import { z } from "zod";
import { artifactContentSchema, artifactIdSchema, artifactSummarySchema } from "./artifacts.js";
import { changeDetailSchema, changeIdSchema, changeSummarySchema } from "./changes.js";
import { chatgptLoginSchema, chatgptStatusSchema } from "./chatgpt.js";
import {
  docsEntryPropertiesSchema,
  docsOpenerSchema,
  docsScopeSchema,
  docsSystemAppSchema,
  docsTreeEntrySchema,
  documentOpenSchema,
  documentSchema,
  documentSearchHitSchema,
  documentVolumeSchema,
  indexerStateSchema,
  viewerContentSchema,
} from "./documents.js";
import { downloadIdSchema, webDownloadSchema } from "./downloads.js";
import { type VeraError, veraErrorSchema } from "./errors.js";
import {
  pluginIdSchema,
  pluginInstalledSchema,
  pluginInstallRequestSchema,
  pluginListRequestSchema,
  pluginSummarySchema,
  pluginToggleRequestSchema,
} from "./plugins.js";
import {
  providerDiscoveryRequestSchema,
  providerDiscoverySchema,
  reasoningOptionSchema,
} from "./provider-discovery.js";
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
  webAccessCancelSchema,
  webAccessProviderSchema,
  webAccessSaveResultSchema,
  webAccessSaveSchema,
  webAccessSnapshotSchema,
  webAccessTestResultSchema,
  webAccessTestSchema,
} from "./web-access.js";
import {
  configSnapshotSchema,
  documentPreviewSchema,
  documentScanSchema,
  pinnedSchema,
  workbenchIdSchema,
  workbenchPatchSchema,
  workbenchSnapshotSchema,
} from "./workbench.js";

/** What the New Workbench page learns about a chosen folder before creating anything in it. */
export const workbenchInspectionSchema = z.strictObject({
  folder: z.string().min(1),
  name: z.string(),
  existing: z.boolean(),
  instructions: z.string().nullable(),
  skills: z.array(skillSummarySchema).max(2048),
});
export type WorkbenchInspection = z.infer<typeof workbenchInspectionSchema>;
export const workbenchCreateSchema = z.strictObject({
  folder: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  config: workbenchPatchSchema.omit({ name: true }).optional(),
  instructions: z.string().optional(),
});
export type WorkbenchCreate = z.input<typeof workbenchCreateSchema>;

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
  "web.access.get": defineChannel("web.access.get", z.strictObject({}), webAccessSnapshotSchema),
  "web.access.save": defineChannel("web.access.save", webAccessSaveSchema, webAccessSaveResultSchema),
  "web.access.removeKey": defineChannel("web.access.removeKey", webAccessProviderSchema, z.strictObject({})),
  "web.access.test": defineChannel("web.access.test", webAccessTestSchema, webAccessTestResultSchema),
  "web.access.cancel": defineChannel("web.access.cancel", webAccessCancelSchema, z.strictObject({})),
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
  "plugins.list": defineChannel(
    "plugins.list",
    pluginListRequestSchema,
    z.array(pluginSummarySchema).max(1024),
  ),
  "plugins.install": defineChannel("plugins.install", pluginInstallRequestSchema, pluginInstalledSchema),
  "plugins.uninstall": defineChannel(
    "plugins.uninstall",
    z.strictObject({ id: pluginIdSchema }),
    z.strictObject({}),
  ),
  "plugins.toggle": defineChannel("plugins.toggle", pluginToggleRequestSchema, z.strictObject({})),
  "docs.list": defineChannel(
    "docs.list",
    docsScopeSchema,
    docsScopeSchema.extend({ documents: z.array(documentSchema) }),
  ),
  "docs.tree": defineChannel(
    "docs.tree",
    docsScopeSchema.extend({ path: z.string().max(4096) }),
    docsScopeSchema.extend({
      path: z.string().max(4096),
      entries: z.array(docsTreeEntrySchema).max(5000),
      truncated: z.boolean(),
    }),
  ),
  "docs.find": defineChannel(
    "docs.find",
    docsScopeSchema.extend({ query: z.string().trim().min(1).max(200) }),
    docsScopeSchema.extend({ paths: z.array(z.string().min(1)).max(200), truncated: z.boolean() }),
  ),
  "docs.read": defineChannel(
    "docs.read",
    docsScopeSchema.extend({ path: z.string().min(1).max(4096) }),
    docsScopeSchema.extend({ content: viewerContentSchema }),
  ),
  "docs.stat": defineChannel(
    "docs.stat",
    docsScopeSchema.extend({ path: z.string().min(1).max(4096) }),
    docsScopeSchema.extend({ properties: docsEntryPropertiesSchema }),
  ),
  "docs.openers": defineChannel(
    "docs.openers",
    z.strictObject({}),
    z.strictObject({ apps: z.array(docsOpenerSchema).max(5) }),
  ),
  "docs.openWith": defineChannel(
    "docs.openWith",
    docsScopeSchema.extend({ path: z.string().min(1).max(4096), app: docsOpenerSchema }),
    z.strictObject({}),
  ),
  "docs.systemApps": defineChannel(
    "docs.systemApps",
    docsScopeSchema.extend({ path: z.string().min(1).max(4096) }),
    z.strictObject({ apps: z.array(docsSystemAppSchema).max(50) }),
  ),
  "docs.openSystemApp": defineChannel(
    "docs.openSystemApp",
    docsScopeSchema.extend({ path: z.string().min(1).max(4096), app: docsSystemAppSchema.shape.id }),
    z.strictObject({}),
  ),
  "docs.reveal": defineChannel(
    "docs.reveal",
    docsScopeSchema.extend({ path: z.string().min(1).max(4096) }),
    z.strictObject({}),
  ),
  "docs.copyPath": defineChannel(
    "docs.copyPath",
    docsScopeSchema.extend({
      path: z.string().min(1).max(4096),
      form: z.enum(["absolute", "relative", "name"]),
    }),
    z.strictObject({}),
  ),
  "docs.volume": defineChannel(
    "docs.volume",
    docsScopeSchema,
    docsScopeSchema.extend({ volume: documentVolumeSchema.nullable() }),
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
  "indexer.status": defineChannel(
    "indexer.status",
    z.strictObject({}),
    z.strictObject({ state: indexerStateSchema }),
  ),
  "indexer.restart": defineChannel("indexer.restart", z.strictObject({}), z.strictObject({})),
  "downloads.list": defineChannel(
    "downloads.list",
    docsScopeSchema,
    docsScopeSchema.extend({ downloads: z.array(webDownloadSchema) }),
  ),
  "downloads.open": defineChannel(
    "downloads.open",
    docsScopeSchema.extend({ downloadId: downloadIdSchema }),
    docsScopeSchema.extend({ downloadId: downloadIdSchema, content: viewerContentSchema }),
  ),
  // Shows a stored download of the open workbench in the file manager; main resolves the path.
  "downloads.reveal": defineChannel(
    "downloads.reveal",
    z.strictObject({ downloadId: downloadIdSchema }),
    z.strictObject({}),
  ),
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
  // Opens an allowlisted workbench document with the operating system's default application.
  "app.openPath": defineChannel(
    "app.openPath",
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
      reuseEmpty: z.boolean().optional(),
      modelRef: modelReferenceSchema.nullable().optional(),
      mode: permissionModeSchema.optional(),
    }),
    sessionSummarySchema,
  ),
  "session.revision": defineChannel(
    "session.revision",
    z.strictObject({ sessionId: sessionIdSchema }),
    z.strictObject({ seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
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
  "session.move": defineChannel(
    "session.move",
    z.strictObject({
      workbenchId: workbenchIdSchema,
      sessionId: sessionIdSchema,
      offset: z.union([z.literal(-1), z.literal(1)]),
    }),
    z.strictObject({}),
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
  "session.reasoning.get": defineChannel(
    "session.reasoning.get",
    z.strictObject({ sessionId: sessionIdSchema }),
    z.strictObject({
      modelRef: modelReferenceSchema,
      options: z.array(reasoningOptionSchema).max(16),
      selected: reasoningOptionSchema.nullable(),
    }),
  ),
  "session.reasoning.set": defineChannel(
    "session.reasoning.set",
    z.strictObject({
      sessionId: sessionIdSchema,
      modelRef: modelReferenceSchema,
      reasoning: reasoningOptionSchema.nullable(),
    }),
    z.strictObject({
      modelRef: modelReferenceSchema,
      options: z.array(reasoningOptionSchema).max(16),
      selected: reasoningOptionSchema.nullable(),
    }),
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
    // `start` is only where the dialog opens; the picked folder is still validated by its caller.
    z.strictObject({ start: z.string().min(1).max(4096).optional() }),
    z.strictObject({ folder: z.string().min(1).nullable() }),
  ),
  "workbench.inspect": defineChannel(
    "workbench.inspect",
    z.strictObject({ folder: z.string().min(1) }),
    workbenchInspectionSchema,
  ),
  "workbench.create": defineChannel("workbench.create", workbenchCreateSchema, workbenchSnapshotSchema),
  "workbench.scanDocs": defineChannel(
    "workbench.scanDocs",
    z.strictObject({ folder: z.string().min(1) }),
    documentScanSchema,
  ),
  "workbench.previewDocs": defineChannel(
    "workbench.previewDocs",
    z.strictObject({
      folder: z.string().min(1),
      include: z.array(z.string()).max(1000),
      exclude: z.array(z.string()).max(1000),
    }),
    documentPreviewSchema,
  ),
  "workbench.relativeFolder": defineChannel(
    "workbench.relativeFolder",
    z.strictObject({ root: z.string().min(1), folder: z.string().min(1) }),
    z.strictObject({ path: z.string().min(1) }),
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
      move: z
        .strictObject({ folder: z.string().min(1), offset: z.union([z.literal(-1), z.literal(1)]) })
        .optional(),
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
