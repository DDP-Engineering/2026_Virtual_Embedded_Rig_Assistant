import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  createDownloadPdfExtractor,
  embeddingModelId,
  type LlmGateway,
  modelSchema,
  PluginCatalog,
  PluginStore,
  ProgramRunner,
  Provisioner,
  pluginPlatform,
  SettingsService,
  splitModelReference,
  WebDownloads,
  WorkbenchService,
} from "@vera/core";
import { eventEnvelopeSchema, veraError, workbenchPatchSchema } from "@vera/shared";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  utilityProcess,
} from "electron";
import { getAppInfo } from "./app-info.js";
import { exportArtifact, publicArtifact, revealArtifact } from "./artifacts.js";
import { CatalogChecks } from "./catalog-checks.js";
import { ChatgptAuth } from "./chatgpt-auth.js";
import { CredentialFile } from "./credentials.js";
import { configureDataLocations } from "./data-locations.js";
import { publicDocument, publicDocumentHit, publicViewer, publicWebDownload } from "./document-viewer.js";
import { createDesktopDownloadTransfer } from "./download-transfer.js";
import { createEventEmitter, sanitizeSessionSnapshot, sanitizeSessionSummary } from "./events.js";
import { createFileAccess } from "./file-access.js";
import { systemClock } from "./host-ports.js";
import { IndexerHost } from "./indexer-host.js";
import { createInvokeRouter } from "./ipc-router.js";
import { createLogger } from "./logger.js";
import { openExternal } from "./open-external.js";
import {
  copyEntry,
  detectOpeners,
  launchDetached,
  type Opener,
  type OpenerId,
  openSystemApp,
  openWith,
  pathExists,
  readOptionalText,
  revealEntry,
  runTool,
  type SystemAppDeps,
  systemApps,
} from "./openers.js";
import { createDesktopProcessHost } from "./process-host.js";
import { testProgramResolver } from "./program-resolver.js";
import { ProviderGateway } from "./provider-gateway.js";
import { ProviderSettings } from "./provider-settings.js";
import { openPath, revealPath } from "./reveal-path.js";
import { bundledResponse, installSessionPolicy, secureSession, secureWindow } from "./security.js";
import { exportSession } from "./session-export.js";
import { createSessionOrder } from "./session-order.js";
import { SessionsHost } from "./sessions.js";
import { desktopUpdateBackend, updateDistribution } from "./update-backend.js";
import { Updates } from "./updates.js";
import { WebAccessService } from "./web-access.js";
import { popupWindowMenu, restoreWindowBounds, titleBarOverlay } from "./window-chrome.js";
import { loadWindowState, saveWindowState } from "./window-state.js";
import { createDesktopWorkerPool } from "./worker-pool.js";

const here = dirname(fileURLToPath(import.meta.url));
declare const __VERA_DEV__: boolean;
declare const __VERA_TEST__: boolean;
declare const __VERA_UPDATE_URL__: string;
/** The default plugin catalog folder (build input VERA_PLUGIN_CATALOG_URL); empty when none. */
declare const __VERA_PLUGIN_CATALOG_URL__: string;
declare const __VERA_SIGNED__: boolean;
app.setName(__VERA_TEST__ ? "VERA Test" : "VERA");
// Datasheet CDNs can reject Chromium HTTP/2 streams. Keep its anonymous download transport on HTTP/1.1.
app.commandLine.appendSwitch("disable-http2");
installSessionPolicy(app);
// pi-ai's public standalone entrypoint makes its variable OAuth imports available in bundles.
registerBunOAuthFlows();
const userData = app.commandLine.getSwitchValue("user-data-dir");
const dataLocations = configureDataLocations(app, process.execPath, userData);

protocol.registerSchemesAsPrivileged([
  { scheme: "vera", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let window: BrowserWindow | undefined;
nativeTheme.on("updated", () => {
  if (window && !window.isDestroyed())
    window.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors));
});
const fileWorkers = createDesktopWorkerPool();
const downloadTransfer = createDesktopDownloadTransfer();
const models = app.isPackaged
  ? join(process.resourcesPath, "models")
  : join(here, "../../../../../src/models");
const manifest = app.isPackaged
  ? join(process.resourcesPath, "model-manifest.json")
  : join(models, "model-manifest.json");
// Selection, hashing, extraction, chunking and embeddings run in the VERA Indexer process; main
// keeps every SQLite write (TASK-f09609fd).
const indexer = new IndexerHost({
  spawn: () =>
    utilityProcess.fork(
      fileURLToPath(new URL("./indexer-process.js", import.meta.url)),
      [`--models=${models}`, `--manifest=${manifest}`],
      { serviceName: "VERA Indexer" },
    ),
  modelId: embeddingModelId(modelSchema.parse(JSON.parse(readFileSync(manifest, "utf8")))),
  status: (state) => {
    emitAppEvent({ topic: "app", id: "app", event: { type: "indexer.status", state } });
    if (state === "running") workbench.refreshDocuments();
  },
});
if (__VERA_TEST__) Object.assign(globalThis, { veraTestIndexerPid: () => indexer.pid() });
let closeFileProbe: (() => Promise<void>) | undefined;
let rendererUrl = "vera://app/index.html";
let updates: Updates | undefined;
export const emitAppEvent = createEventEmitter(
  () => window?.webContents,
  (text) => credentials.scrub(text),
);
const logger = createLogger(dataLocations.paths.logs, systemClock);
const credentials = new CredentialFile({
  file: join(dataLocations.paths.userData, "credentials.json"),
  files: createFileAccess(systemClock),
  crypto: safeStorage,
  logger,
  platform: process.platform,
});
const settings = new SettingsService({
  files: createFileAccess(systemClock),
  paths: dataLocations.paths,
  uuid: randomUUID,
  changed: () => {
    emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } });
    updates?.settingsChanged();
  },
});
const sessionOrder = createSessionOrder(settings);
const workbench = new WorkbenchService(
  {
    userData: dataLocations.paths.userData,
    files: createFileAccess(systemClock),
    settings,
    pid: process.pid,
    appVersion: app.getVersion(),
    now: () => systemClock.now(),
    token: randomUUID,
    isProcessAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
      }
    },
    changed: (event) => {
      emitAppEvent(eventEnvelopeSchema.parse(event));
    },
  },
  indexer.processor,
);
/** Installed plugins live under userData; enablement is per workbench (workbench.yaml). */
const plugins = new PluginStore({ root: join(dataLocations.paths.userData, "plugins") });
const processHost = createDesktopProcessHost();
/** Plugin program runs; session stop, workbench close and app exit kill their process trees. */
const programs = new ProgramRunner({ host: processHost, clock: systemClock });
/** The pinned uv of the package, or the one prepare:uv placed in the source tree for development. */
const uvBinary = join(
  app.isPackaged
    ? join(process.resourcesPath, "uv")
    : join(here, "../../../../../src/uv", pluginPlatform(process.platform, process.arch) ?? "unsupported"),
  process.platform === "win32" ? "uv.exe" : "uv",
);
/** Installs programs only on plugins.provision; resolves them for sessions without installing anything. */
const provisioner = new Provisioner({
  store: plugins,
  root: join(dataLocations.paths.userData, "plugins", "runtime"),
  ...(existsSync(uvBinary) ? { uv: { executable: uvBinary } } : {}),
  host: processHost,
  clock: systemClock,
  platform: pluginPlatform(process.platform, process.arch),
  fetch: (url, { signal }) => net.fetch(url, signal ? { signal } : {}),
  settings: () => settings.get().settings.plugins,
});
/** The official plugins as a catalog release: <resources>/plugins, or prepare:plugins in development. */
const bundledPlugins =
  __VERA_TEST__ && process.env.VERA_TEST_BUNDLED_PLUGINS !== undefined
    ? process.env.VERA_TEST_BUNDLED_PLUGINS || undefined
    : app.isPackaged
      ? join(process.resourcesPath, "plugins")
      : join(here, "../../../../../src/bundled-plugins");
/** The catalog folder from settings, else the build default; the bundled release stands in without one. */
const catalogLocation = () =>
  settings.get().settings.plugins?.catalog ?? (__VERA_PLUGIN_CATALOG_URL__ || undefined);
/** The plugin catalog: verified downloads for review, installs only on the user's action. */
const catalog = new PluginCatalog({
  store: plugins,
  root: join(dataLocations.paths.userData, "plugins", "catalog"),
  location: catalogLocation,
  ...(bundledPlugins ? { bundled: bundledPlugins } : {}),
  fetch: (url, { signal }) => net.fetch(url, signal ? { signal } : {}),
});
/** Update checks at start and every 24 h read the index only, while the update mode is not Off. */
const catalogChecks = new CatalogChecks({
  enabled: () => settings.get().settings.updates.mode !== "off" && Boolean(catalogLocation()),
  check: async () => {
    await catalog.view({ refresh: true });
    emitAppEvent({ topic: "app", id: "app", event: { type: "plugins.catalog" } });
  },
});
/** Runs of the open workbench stop before it closes or another workbench replaces it. */
async function stopWorkbenchPrograms(): Promise<void> {
  let folder: string;
  try {
    folder = workbench.getSnapshot().folder;
  } catch {
    return;
  }
  await programs.stopWorkbench(folder);
}
const providers = new ProviderSettings(settings, credentials);
const webAccess = new WebAccessService({
  settings,
  credentials,
  changed: () => emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } }),
});
let chatgpt = new ChatgptAuth({
  settings,
  credentials,
  openExternal: async (url) => {
    await openExternal({ url, confirmed: true }, (url) => shell.openExternal(url), true);
  },
});
let modelGateway = new ProviderGateway(settings, credentials, providers, systemClock);
const sessions = new SessionsHost({
  web: webAccess.provider,
  downloads: (root) =>
    new WebDownloads(root, {
      access: webAccess.provider,
      transfer: downloadTransfer,
      pdf: createDownloadPdfExtractor(new URL("./pdf-worker.js", import.meta.url)),
    }),
  workbench,
  settings,
  gateway: () => modelGateway,
  credentials,
  clock: systemClock,
  workers: fileWorkers,
  embeddings: indexer.embeddings,
  version: app.getVersion(),
  target: () =>
    window && !window.isDestroyed() ? { webContents: window.webContents, url: rendererUrl } : undefined,
  emit: emitAppEvent,
  // Instrumented builds may resolve fixture plugins from VERA_TEST_PROGRAMS for e2e; otherwise provisioning does.
  programs: {
    runner: programs,
    resolver:
      __VERA_TEST__ && process.env.VERA_TEST_PROGRAMS
        ? testProgramResolver(process.env.VERA_TEST_PROGRAMS)
        : provisioner,
  },
  ...(__VERA_TEST__ && process.env.VERA_TEST_ALLOW_WRITES === "1"
    ? { permissions: { allow: () => true } }
    : {}),
});
ipcMain.handle("vera:subscription", (event, action, payload) =>
  sessions.subscription(event, action, payload),
);
/** The folder of the open workbench when `workbenchId` names it; CONFLICT otherwise. */
function openWorkbenchFolder(workbenchId: string): string {
  const snapshot = workbench.getSnapshot();
  if (snapshot.config.id !== workbenchId) throw veraError("CONFLICT");
  return snapshot.folder;
}
/** A plugin was installed, removed, toggled or provisioned: resolve programs and prompt entries again. */
function pluginsChanged(): void {
  provisioner.invalidate();
  sessions.invalidatePrograms();
}

// Programs that open Docs tree entries, detected once per start on first use (TASK-eae3a69e).
let detected: Map<OpenerId, Opener> | undefined;
const openers = () =>
  (detected ??= detectOpeners({ platform: process.platform, env: process.env, exists: pathExists }));
/** Linux applications registered for a file type (TASK-c49f03d5); the UI language picks their names. */
const systemAppDeps = (): SystemAppDeps => {
  const language = settings.get().settings.language;
  return {
    platform: process.platform,
    run: runTool,
    dataDirs: [
      process.env.XDG_DATA_HOME || join(app.getPath("home"), ".local", "share"),
      ...(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean),
    ],
    readText: readOptionalText,
    // The names follow the UI language, which falls back to English like the renderer does.
    lang:
      language !== "system"
        ? language
        : (["en", "ro", "de"].find((code) => app.getLocale().startsWith(code)) ?? "en"),
    openers: openers(),
  };
};
ipcMain.handle(
  "vera:invoke",
  createInvokeRouter({
    target: () =>
      window && !window.isDestroyed() ? { webContents: window.webContents, url: rendererUrl } : undefined,
    handlers: {
      "web.access.get": () => webAccess.get(),
      "web.access.save": (request) => webAccess.save(request),
      "web.access.removeKey": (request) => webAccess.removeKey(request),
      "web.access.test": (request) => webAccess.test(request),
      "web.access.cancel": (request) => webAccess.cancelTest(request),
      "update.get": () => {
        if (!updates) throw { code: "BUSY", messageKey: "errors.BUSY" };
        return updates.get();
      },
      "update.check": () => {
        if (!updates) throw { code: "BUSY", messageKey: "errors.BUSY" };
        return updates.check();
      },
      "update.download": () => {
        if (!updates) throw { code: "BUSY", messageKey: "errors.BUSY" };
        return updates.download();
      },
      "update.restart": () => {
        if (!updates) throw { code: "BUSY", messageKey: "errors.BUSY" };
        return updates.requestRestart();
      },
      "update.openRelease": ({ version }) => {
        if (!updates) throw { code: "BUSY", messageKey: "errors.BUSY" };
        return updates.openRelease(version);
      },
      "skills.list": ({ workbenchId }) => workbench.listSkills(workbenchId),
      "skills.open": ({ workbenchId, source, name }) => workbench.openSkill(workbenchId, source, name),
      "skills.create": ({ workbenchId, source, name }) => workbench.saveSkill(workbenchId, source, name),
      "skills.save": ({ workbenchId, source, name, content, sha256 }) =>
        workbench.saveSkill(workbenchId, source, name, content, sha256),
      "skills.toggle": ({ workbenchId, name, enabled }) => workbench.toggleSkill(workbenchId, name, enabled),
      "plugins.list": async ({ workbenchId }) => {
        const enabled = workbenchId ? workbench.enabledPlugins(workbenchId) : [];
        return (await plugins.list()).map((plugin) => ({ ...plugin, enabled: enabled.includes(plugin.id) }));
      },
      "plugins.choose": async ({ kind }) => {
        if (__VERA_TEST__ && process.env.VERA_TEST_PLUGIN_PATH)
          return { path: process.env.VERA_TEST_PLUGIN_PATH };
        if (!window || window.isDestroyed()) return { path: null };
        const result = await dialog.showOpenDialog(
          window,
          kind === "folder"
            ? { properties: ["openDirectory"] }
            : { properties: ["openFile"], filters: [{ name: "Zip", extensions: ["zip"] }] },
        );
        return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
      },
      "plugins.review": ({ path }) => plugins.review(path),
      "plugins.install": async ({ path, sha256 }) => {
        const installed = await plugins.install(path, sha256);
        pluginsChanged();
        return installed;
      },
      "plugins.uninstall": async ({ id }) => {
        await plugins.uninstall(id);
        pluginsChanged();
        return {};
      },
      "plugins.toggle": async ({ workbenchId, id, enabled }) => {
        const result = await workbench.togglePlugin(workbenchId, id, enabled);
        pluginsChanged();
        return result;
      },
      "plugins.catalog": ({ refresh }) => catalog.view({ refresh }),
      "plugins.catalogReview": ({ id }) => catalog.review(id),
      "plugins.catalogInstall": async ({ id, sha256 }) => {
        const installed = await catalog.install(id, sha256);
        pluginsChanged();
        return installed;
      },
      "plugins.programs": ({ id }) => provisioner.statuses(id),
      "plugins.provision": async ({ id }) => {
        try {
          return await provisioner.install(id);
        } finally {
          pluginsChanged();
        }
      },
      // Runs of the open workbench only; another workbench id is CONFLICT like the other workbench channels.
      // Arguments and output cross to the renderer redacted, like program approval payloads and documents.
      "runs.list": async ({ workbenchId }) => ({
        runs: (await programs.list(openWorkbenchFolder(workbenchId))).map((run) => ({
          ...run,
          args: run.args.map((arg) => credentials.scrub(arg)),
          ...(run.error === undefined ? {} : { error: credentials.scrub(run.error) }),
        })),
      }),
      "runs.log": async ({ workbenchId, id }) => {
        const log = await programs.log(openWorkbenchFolder(workbenchId), id);
        return { ...log, text: credentials.scrub(log.text) };
      },
      "runs.stop": async ({ workbenchId, id }) => {
        await programs.stopRun(openWorkbenchFolder(workbenchId), id);
        return {};
      },
      "docs.list": async ({ workbenchId }) => ({
        workbenchId,
        documents: (await workbench.listDocuments(workbenchId))
          .map((doc) => publicDocument(doc, (text) => credentials.scrub(text)))
          .filter((doc) => doc !== undefined),
      }),
      // Paths a redaction would change are left out, like docs.list (TASK-66b7d4aa).
      "docs.tree": async ({ workbenchId, path }) => {
        const listed = await workbench.listFolder(workbenchId, path);
        return {
          workbenchId,
          path,
          entries: listed.entries.filter((entry) => credentials.scrub(entry.path) === entry.path),
          truncated: listed.truncated,
        };
      },
      "docs.find": async ({ workbenchId, query }) => {
        const found = await workbench.findFiles(workbenchId, query);
        return {
          workbenchId,
          paths: found.paths.filter((path) => credentials.scrub(path) === path),
          truncated: found.truncated,
        };
      },
      "docs.read": async ({ workbenchId, path }) => ({
        workbenchId,
        content: publicViewer(await workbench.readText(workbenchId, path), (text) => credentials.scrub(text)),
      }),
      "docs.stat": async ({ workbenchId, path }) => ({
        workbenchId,
        properties: await workbench.statEntry(workbenchId, path),
      }),
      // The Docs tree's OS actions go through the tree's confinement first (TASK-eae3a69e).
      "docs.openers": () => ({ apps: [...openers().keys()] }),
      "docs.openWith": ({ workbenchId, path, app }) =>
        openWith(() => workbench.locateEntry(workbenchId, path), app, openers(), launchDetached),
      "docs.systemApps": async ({ workbenchId, path }) => ({
        apps: (await systemApps(() => workbench.locateEntry(workbenchId, path), systemAppDeps())).map(
          ({ id, name }) => ({ id, name }),
        ),
      }),
      "docs.openSystemApp": ({ workbenchId, path, app }) =>
        openSystemApp(() => workbench.locateEntry(workbenchId, path), app, systemAppDeps(), launchDetached),
      "docs.reveal": ({ workbenchId, path }) =>
        revealEntry(
          () => workbench.locateEntry(workbenchId, path),
          (absolute) => shell.showItemInFolder(absolute),
        ),
      "docs.copyPath": ({ workbenchId, path, form }) =>
        copyEntry(
          () => workbench.locateEntry(workbenchId, path),
          path,
          form,
          (text) => clipboard.writeText(text),
          sep,
        ),
      "docs.volume": async ({ workbenchId }) => ({
        workbenchId,
        volume: workbench.documentVolume(workbenchId),
      }),
      "docs.search": async ({ workbenchId, query }) => ({
        workbenchId,
        results: (await workbench.searchDocuments(workbenchId, query))
          .map((hit) => publicDocumentHit(hit, (text) => credentials.scrub(text)))
          .filter((hit) => hit !== undefined),
      }),
      "docs.open": async (request) => {
        const content =
          "sessionId" in request
            ? await sessions.run((service) =>
                workbench.readDocuments(request.workbenchId, () =>
                  service.openCitation(request.sessionId, request.messageId, request.ref),
                ),
              )
            : await workbench.openDocument(
                request.workbenchId,
                "path" in request ? request.path : request.ref,
                "path" in request,
              );
        // Match existing session/artifact disclosure scrubbing, while keeping PDF bytes intact.
        return {
          workbenchId: request.workbenchId,
          content: publicViewer(content, (text) => credentials.scrub(text)),
        };
      },
      "indexer.status": async () => ({ state: indexer.state() }),
      "indexer.restart": async () => {
        indexer.restart();
        return {};
      },
      "docs.reindex": async ({ workbenchId }) => {
        await workbench.reindexDocuments(workbenchId);
        return {};
      },
      "downloads.list": ({ workbenchId }) =>
        sessions.run((service) =>
          workbench.readDocuments(workbenchId, async () => ({
            workbenchId,
            downloads: (await service.listDownloads())
              .map((record) => publicWebDownload(record, (text) => credentials.scrub(text)))
              .filter((record) => record !== undefined),
          })),
        ),
      "downloads.open": ({ workbenchId, downloadId }) =>
        sessions.run((service) =>
          workbench.readDocuments(workbenchId, async () => ({
            workbenchId,
            downloadId,
            content: publicViewer(await service.openDownload(downloadId), (text) => credentials.scrub(text)),
          })),
        ),
      "downloads.reveal": ({ downloadId }) =>
        sessions.run(async (service) => {
          shell.showItemInFolder(await service.locateDownload(downloadId));
          return {};
        }),
      "app.openExternal": (request) => openExternal(request, (url) => shell.openExternal(url)),
      "providers.chatgpt.login": (request) => chatgpt.login(request),
      "providers.chatgpt.cancel": () => chatgpt.cancel(),
      "providers.chatgpt.status": () => chatgpt.status(),
      "providers.chatgpt.logout": () => chatgpt.logout(),
      "artifacts.list": ({ sessionId }) =>
        sessions.run((s) =>
          s.listArtifacts(sessionId).map((a) => publicArtifact(a, (text) => credentials.scrub(text))),
        ),
      "artifacts.open": ({ artifactId }) =>
        sessions.run(async (s) =>
          publicArtifact(await s.openArtifact(artifactId), (text) => credentials.scrub(text)),
        ),
      "artifacts.reveal": ({ artifactId }) =>
        sessions.run((s) => revealArtifact(s, artifactId, (path) => shell.showItemInFolder(path))),
      "artifacts.export": ({ artifactId }) =>
        sessions.run((s) =>
          exportArtifact(s, artifactId, {
            root: workbench.getSnapshot().folder,
            choose: async (name) => {
              if (__VERA_TEST__ && process.env.VERA_TEST_DIALOG_PATH)
                return process.env.VERA_TEST_DIALOG_PATH;
              if (!window || window.isDestroyed()) return null;
              const result = await dialog.showSaveDialog(window, { defaultPath: name });
              return result.canceled ? null : (result.filePath ?? null);
            },
            write: (path, content) => createFileAccess(systemClock).writeAtomic(path, content),
            scrub: (text) => credentials.scrub(text),
          }),
        ),
      "changes.list": ({ sessionId }) =>
        sessions.run((s) => s.listChanges(sessionId).map((c) => ({ ...c, path: credentials.scrub(c.path) }))),
      "changes.get": ({ changeId }) =>
        sessions.run((s) => {
          const c = s.getChange(changeId);
          return { ...c, path: credentials.scrub(c.path), diff: credentials.scrub(c.diff) };
        }),
      "app.revealPath": ({ path }) =>
        sessions.run(() =>
          revealPath(workbench.getSnapshot().folder, path, (absolute) => shell.showItemInFolder(absolute)),
        ),
      "app.openPath": ({ path }) =>
        sessions.run(() =>
          openPath(workbench.getSnapshot().folder, path, (absolute) => shell.openPath(absolute)),
        ),
      "session.list": ({ workbenchId }) =>
        sessions.run((s) => {
          if (workbenchId && workbench.getSnapshot().config.id !== workbenchId) throw veraError("CONFLICT");
          return sessionOrder
            .list(workbench.getSnapshot().config.id, s.list())
            .map((item) => sanitizeSessionSummary(item, (text) => credentials.scrub(text)));
        }),
      "session.move": ({ workbenchId, sessionId, offset }) =>
        sessions.run(async (s) => {
          if (workbench.getSnapshot().config.id !== workbenchId) throw veraError("CONFLICT");
          await sessionOrder.move(workbenchId, s.list(), sessionId, offset);
          return {};
        }),
      "session.search": ({ query, workbenchId }) =>
        sessions.run((s) => {
          if (workbenchId && workbench.getSnapshot().config.id !== workbenchId) throw veraError("CONFLICT");
          return s
            .search(query)
            .map((item) => sanitizeSessionSummary(item, (text) => credentials.scrub(text)));
        }),
      "session.export": ({ sessionId, format }) =>
        sessions.run((s) =>
          exportSession(s, sessionId, format, {
            root: workbench.getSnapshot().folder,
            choose: async (name) => {
              if (__VERA_TEST__ && process.env.VERA_TEST_DIALOG_PATH)
                return process.env.VERA_TEST_DIALOG_PATH;
              if (!window || window.isDestroyed()) return null;
              const result = await dialog.showSaveDialog(window, {
                defaultPath: name,
                filters: [{ name: format === "md" ? "Markdown" : "JSON", extensions: [format] }],
              });
              return result.canceled ? null : (result.filePath ?? null);
            },
            write: (path, content) => createFileAccess(systemClock).writeAtomic(path, content),
            scrub: (text) => credentials.scrub(text),
          }),
        ),
      "session.create": ({ modelRef, mode, workbenchId, reuseEmpty }) =>
        sessions.run((s) => {
          if (workbenchId && workbench.getSnapshot().config.id !== workbenchId) throw veraError("CONFLICT");
          if (credentials.containsSecret(modelRef)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          return sanitizeSessionSummary(s.create(modelRef, mode, reuseEmpty), (text) =>
            credentials.scrub(text),
          );
        }),
      "session.revision": ({ sessionId }) => sessions.run((service) => service.revision(sessionId)),
      "session.get": ({ sessionId }) =>
        sessions.run((s) => {
          const value = s.get(sessionId);
          return {
            ...value,
            snapshot: sanitizeSessionSnapshot(value.snapshot, (text) => credentials.scrub(text)),
          };
        }),
      "session.rename": ({ sessionId, title }) =>
        sessions.run((s) => {
          if (credentials.containsSecret(title)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          return sanitizeSessionSummary(s.rename(sessionId, title), (text) => credentials.scrub(text));
        }),
      "session.archive.set": ({ sessionId, archived }) =>
        sessions.run((s) =>
          sanitizeSessionSummary(s.setArchived(sessionId, archived), (text) => credentials.scrub(text)),
        ),
      "session.delete": ({ sessionId }) =>
        sessions.run(async (s) => {
          await s.delete(sessionId);
          return {};
        }),
      "session.send": ({ sessionId, text }) =>
        sessions.run((s) => {
          if (credentials.containsSecret(text)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          return s.send(sessionId, text);
        }),
      "session.stop": ({ sessionId }) => {
        return sessions.run((s) => ({ stopped: s.stop(sessionId) }));
      },
      "session.approval.decide": (request) =>
        sessions.run((s) => {
          s.decideApproval(request);
          return {};
        }),
      "session.reasoning.get": ({ sessionId }) =>
        sessions.run(async (s) => {
          const value = await s.reasoningOptions(sessionId);
          return {
            modelRef: credentials.scrub(value.modelRef),
            options: value.options.map((v) => credentials.scrub(v)),
            selected: value.selected === null ? null : credentials.scrub(value.selected),
          };
        }),
      "session.reasoning.set": ({ sessionId, modelRef, reasoning }) =>
        sessions.run(async (s) => {
          if (credentials.containsSecret(modelRef) || credentials.containsSecret(reasoning))
            throw { code: "INVALID", messageKey: "errors.INVALID" };
          const value = await s.setReasoning(sessionId, reasoning, modelRef);
          return {
            modelRef: credentials.scrub(value.modelRef),
            options: value.options.map((v) => credentials.scrub(v)),
            selected: value.selected === null ? null : credentials.scrub(value.selected),
          };
        }),
      "session.model.set": ({ sessionId, modelRef }) =>
        sessions.run((s) => {
          if (credentials.containsSecret(modelRef)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          return sanitizeSessionSummary(s.setModel(sessionId, modelRef), (text) => credentials.scrub(text));
        }),
      "session.mode.set": ({ sessionId, mode }) =>
        sessions.run((s) =>
          sanitizeSessionSummary(s.setMode(sessionId, mode), (text) => credentials.scrub(text)),
        ),
      "providers.discover": (request) => modelGateway.discover(request),
      "providers.models": ({ id }) => modelGateway.models(id),
      "providers.test": ({ id, model }) => modelGateway.test(id, model),
      "providers.list": () => providers.list(),
      "providers.save": (request) => providers.save(request),
      "providers.remove": (request) => providers.remove(request),
      "app.info": () => getAppInfo(dataLocations.portable),
      "window.menu": (request) => popupWindowMenu(window, request),
      "app.settings.get": () => {
        const snapshot = settings.get();
        if (credentials.containsSecret(snapshot)) throw { code: "INVALID", messageKey: "errors.INVALID" };
        return snapshot;
      },
      "app.settings.update": async (patch) => {
        if (credentials.containsSecret(patch)) throw { code: "INVALID", messageKey: "errors.INVALID" };
        const result = await settings.update(patch);
        nativeTheme.themeSource = result.settings.theme;
        return result;
      },
      "app.chooseFolder": async ({ start }) => {
        if (__VERA_TEST__ && process.env.VERA_TEST_DIALOG_PATH)
          return { folder: process.env.VERA_TEST_DIALOG_PATH };
        if (!window || window.isDestroyed()) return { folder: null };
        const result = await dialog.showOpenDialog(window, {
          properties: ["openDirectory", "createDirectory"],
          ...(start && isAbsolute(start) ? { defaultPath: start } : {}),
        });
        return { folder: result.canceled ? null : (result.filePaths[0] ?? null) };
      },
      "workbench.inspect": ({ folder }) => workbench.inspect(folder),
      "workbench.scanDocs": ({ folder }) => workbench.scanDocuments(folder),
      "workbench.previewDocs": ({ folder, include, exclude }) =>
        workbench.previewDocuments(folder, { include, exclude }),
      "workbench.relativeFolder": async ({ root, folder }) => ({
        path: await workbench.relativeFolder(root, folder),
      }),
      "workbench.create": ({ folder, name, config, instructions }) =>
        sessions.lifecycle(async () => {
          await stopWorkbenchPrograms();
          return workbench.create(folder, name, {
            ...(config ? { config } : {}),
            ...(instructions !== undefined ? { instructions } : {}),
          });
        }),
      "workbench.open": ({ folder }) =>
        sessions.lifecycle(async () => {
          await stopWorkbenchPrograms();
          return workbench.open(folder);
        }),
      "workbench.close": async () => {
        await sessions.lifecycle(async () => {
          await stopWorkbenchPrograms();
          await workbench.close();
        });
        return {};
      },
      "workbench.recent": async ({ remove, pin, move, reveal }) => {
        const entries = await workbench.recent(remove, pin, move);
        if (reveal !== undefined) {
          const entry = entries.find((item) => item.folder === reveal && !item.missing);
          if (!entry) throw veraError("NOT_FOUND");
          const error = await shell.openPath(entry.folder);
          if (error) throw veraError("INTERNAL");
        }
        return entries;
      },
      "workbench.config.get": async () => ({
        ...(await workbench.getConfig()),
        readOnly: workbench.getSnapshot().readOnly,
        folder: workbench.getSnapshot().folder,
      }),
      "workbench.config.update": ({ patch, workbenchId }) =>
        workbench.updateConfig(workbenchPatchSchema.parse(patch), workbenchId),
      "workbench.pinned.get": () => workbench.getPinned(),
      "workbench.pinned.update": ({ content, workbenchId }) => workbench.updatePinned(content, workbenchId),
      "workbench.files": ({ query }) => workbench.files(query),
    },
    log: (failure) => logger.log("error", "ipc.internal", failure),
    sanitize: (value) => credentials.sanitize(value),
  }),
);

async function createWindow(): Promise<void> {
  Menu.setApplicationMenu(null);
  const stateFile = join(app.getPath("userData"), "window-state.json");
  const state = await loadWindowState(
    stateFile,
    screen.getAllDisplays().map((display) => display.workArea),
  );
  window = new BrowserWindow({
    title: "VERA",
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors),
    ...state.bounds,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      // Chromium otherwise downloads Hunspell dictionaries from an external CDN.
      spellcheck: false,
    },
  });
  secureWindow(window);
  window.removeMenu();
  restoreWindowBounds(window, state.bounds);
  const created = window;
  created.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) sessions.clearSubscriptions();
  });
  let closing = false;
  created.on("close", (event) => {
    if (updates?.hasDownloaded && !updates.shuttingDown) {
      event.preventDefault();
      updates.requestQuit();
      return;
    }
    event.preventDefault();
    if (closing) return;
    closing = true;
    saveWindowState(stateFile, created.getNormalBounds())
      .catch(() => logger.log("error", "window.state.save.failed"))
      .finally(() => created.destroy());
  });
  window.on("closed", () => {
    sessions.clearSubscriptions();
    window = undefined;
  });
  window.once("ready-to-show", () => window?.show());
  // electron-vite supplies this only to the development launch.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (__VERA_DEV__ && devUrl && !app.isPackaged) {
    const url = new URL(devUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "5173") {
      throw new Error("Unexpected renderer development origin");
    }
    rendererUrl = url.href;
    await window.loadURL(rendererUrl);
  } else {
    rendererUrl = "vera://app/index.html";
    await window.loadURL(rendererUrl);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let draining = false;
  let drained = false;
  app.on("before-quit", (event) => {
    if (drained) return;
    event.preventDefault();
    if (updates?.hasDownloaded && !updates.shuttingDown) {
      updates.requestQuit();
      return;
    }
    if (draining) return;
    draining = true;
    // Installs and probes stop with the app; their uv and tar process trees are killed.
    provisioner.close();
    catalogChecks.close();
    void programs
      .stopAll()
      .then(() => sessions.close())
      .then(() => workbench.close())
      .then(() => fileWorkers.dispose())
      .then(() => indexer.close())
      .then(() => closeFileProbe?.())
      .then(() => modelGateway.close())
      .then(() => chatgpt.close())
      .then(() => providers.close())
      .then(() => webAccess.close())
      .then(() => credentials.close())
      .then(() => settings.close())
      .then(() => logger.flush())
      .then(() => {
        drained = true;
        if (!updates?.finishShutdown()) {
          updates?.close();
          app.quit();
        }
      })
      .catch(() => {
        console.error("VERA shutdown persistence failed");
        // A failed drain must never start the installer.
        updates?.close();
        drained = true;
        app.quit();
      });
  });
  let logsDraining = false;
  let logsDrained = false;
  app.on("will-quit", (event) => {
    if (logsDrained) return;
    event.preventDefault();
    if (logsDraining) return;
    logsDraining = true;
    void logger
      .flush()
      .catch(() => {
        console.error("VERA log persistence failed");
      })
      .finally(() => {
        logsDrained = true;
        app.quit();
      });
  });
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app
    .whenReady()
    .then(async () => {
      if (draining) return;
      secureSession(session.defaultSession);
      await settings.load();
      await credentials.load();
      updates = new Updates({
        distribution: updateDistribution(dataLocations.portable),
        configured: Boolean(__VERA_UPDATE_URL__),
        backend: __VERA_UPDATE_URL__
          ? desktopUpdateBackend(
              __VERA_UPDATE_URL__,
              dataLocations.portable,
              __VERA_SIGNED__,
              (kind, event) => logger.log(kind, event),
            )
          : { check: async () => null, download: async () => {}, install: () => {} },
        preferences: () => settings.get().settings.updates,
        emit: (event) => emitAppEvent({ topic: "app", id: "app", event }),
        beginShutdown: () => sessions.beginShutdown(),
        quit: () => app.quit(),
        openExternal: async (url) => {
          await openExternal({ url, confirmed: true }, (link) => shell.openExternal(link));
        },
      });
      if (__VERA_TEST__ && ["1", "startup"].includes(process.env.VERA_TEST_CHATGPT ?? "")) {
        const { scriptedSubscription } = await import("./chatgpt-probe.js");
        chatgpt = new ChatgptAuth({
          settings,
          credentials,
          ...(process.env.VERA_TEST_CHATGPT === "1" ? { createCollection: scriptedSubscription } : {}),
          openExternal: async (url) => {
            await openExternal({ url, confirmed: true }, async () => {}, true);
          },
        });
      }
      if (__VERA_TEST__) {
        const { createFileToolProbe } = await import("./file-tool-probe.js");
        const probe = createFileToolProbe();
        Object.assign(globalThis, { veraTestFileTools: probe });
        closeFileProbe = () => probe.dispose();
      }
      if (app.commandLine.hasSwitch("vera-smoke-provider")) {
        let exitCode = 1;
        try {
          const result = await modelGateway.test(app.commandLine.getSwitchValue("vera-smoke-provider"));
          console.log(JSON.stringify(result));
          exitCode = result.steps.every(
            (step) => step.status === "pass" || (step.step === "reachability" && step.status === "skipped"),
          )
            ? 0
            : 1;
        } catch {
          console.log(JSON.stringify({ code: "INVALID", messageKey: "errors.INVALID" }));
        }
        await modelGateway.close();
        await providers.close();
        await webAccess.close();
        await credentials.close();
        await settings.close();
        await logger.flush();
        app.exit(exitCode);
        return;
      }
      if (__VERA_TEST__ && process.env.VERA_REPLAY_DIR) {
        const { ReplayGateway } = await import("@vera/core/replay");
        const { setTimeout: replayWait } = await import("node:timers/promises");
        const replayDelay = Math.max(0, Math.min(1000, Number(process.env.VERA_REPLAY_DELAY_MS) || 0));
        const replay = new ReplayGateway({
          dir: process.env.VERA_REPLAY_DIR,
          now: () => systemClock.now().getTime(),
          delay: async (signal) => {
            if (replayDelay) await replayWait(replayDelay, undefined, { signal });
          },
        });
        const api = modelGateway.api;
        const select = (id: string): LlmGateway => (id === "replay" ? replay : api);
        const gateway: LlmGateway = {
          prepareModel: (ref, signal) =>
            select(splitModelReference(ref).provider).prepareModel?.(ref, signal) ?? Promise.resolve(),
          selectedModel: (id) => select(id).selectedModel(id),
          capabilities: (ref, output) => select(splitModelReference(ref).provider).capabilities(ref, output),
          models: (id, signal, probe) => select(id).models(id, signal, probe),
          stream: (request) => select(splitModelReference(request.model).provider).stream(request),
        };
        await modelGateway.close();
        modelGateway = new ProviderGateway(
          settings,
          credentials,
          providers,
          systemClock,
          gateway,
          () => `replay/${replay.selectedModel("replay")}`,
        );
      }
      nativeTheme.themeSource = settings.get().settings.theme;
      if (draining) return;
      logger.log("info", "app.started", { portable: dataLocations.portable });
      protocol.handle("vera", (request) => bundledResponse(join(here, "../renderer"), request));
      if (__VERA_TEST__ && app.commandLine.hasSwitch("packaging-probe")) {
        const { runPackagingProbe } = await import("./packaging/probe.js");
        app.exit(await runPackagingProbe(app.commandLine.getSwitchValue("packaging-probe")));
        return;
      }
      await createWindow();
      updates.start();
      catalogChecks.start();
    })
    .catch(async () => {
      logger.log("error", "app.startup.failed");
      try {
        await logger.flush();
      } catch {
        console.error("VERA log persistence failed");
      }
      app.exit(1);
    });
}
