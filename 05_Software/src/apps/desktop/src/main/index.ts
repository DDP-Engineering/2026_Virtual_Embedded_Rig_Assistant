import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  createCommandShellHost,
  createDownloadPdfExtractor,
  createMaskingResolver,
  detectCommandShells,
  embeddingModelId,
  HelpLibrary,
  type LlmGateway,
  leaseRoot,
  modelSchema,
  PluginCatalog,
  PluginStore,
  ProgramRunner,
  Provisioner,
  pluginPlatform,
  ResourceLeases,
  readPluginHelp,
  SettingsService,
  settingStates,
  splitModelReference,
  WebDownloads,
  WorkbenchService,
} from "@vera/core";
import {
  eventEnvelopeSchema,
  type HelpLanguage,
  type HelpPage,
  type HelpPageSummary,
  helpLanguages,
  type Settings,
  settingsChangedEvent,
  veraError,
  type WorkbenchSnapshot,
  workbenchPatchSchema,
} from "@vera/shared";
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
  type SaveDialogOptions,
  safeStorage,
  screen,
  session,
  shell,
  utilityProcess,
} from "electron";
import { getAppInfo } from "./app-info.js";
import { exportArtifact, exportName, publicArtifact, revealArtifact } from "./artifacts.js";
import { CatalogChecks } from "./catalog-checks.js";
import { ChatgptAuth } from "./chatgpt-auth.js";
import { CredentialFile } from "./credentials.js";
import { configureDataLocations } from "./data-locations.js";
import { DisplayDocuments } from "./display-documents.js";
import { DisplayIdentities, loadDisplayIdentityKey } from "./display-identities.js";
import { publicViewer, publicWebDownload } from "./document-viewer.js";
import { createDesktopDownloadTransfer } from "./download-transfer.js";
import { createEmbeddingWarmup } from "./embedding-warmup.js";
import {
  createEventEmitter,
  publicGuard,
  rendererSessionSnapshot,
  sanitizeEvent,
  sanitizeSessionSummary,
} from "./events.js";
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
import { PartsAccessService } from "./parts-access.js";
import { PluginCredentialService, programCredentials } from "./plugin-credentials.js";
import { PluginListingHost } from "./plugin-list-host.js";
import { createDesktopProcessHost } from "./process-host.js";
import { testProgramResolver } from "./program-resolver.js";
import { ProviderGateway } from "./provider-gateway.js";
import { ProviderSettings } from "./provider-settings.js";
import { ProvisionerHosts } from "./provisioner-hosts.js";
import { recoverRenderer } from "./renderer-recovery.js";
import { openPath, revealPath } from "./reveal-path.js";
import { RunPresentation } from "./run-presentation.js";
import { bundledResponse, installSessionPolicy, secureSession, secureWindow } from "./security.js";
import { exportSession } from "./session-export.js";
import { createSessionOrder } from "./session-order.js";
import { installSessionPerformance } from "./session-performance.js";
import { SessionsHost } from "./sessions.js";
import { drainShutdown } from "./shutdown.js";
import { createPtyFactory } from "./terminal-pty.js";
import { TerminalService } from "./terminals.js";
import { desktopUpdateBackend, updateDistribution } from "./update-backend.js";
import { Updates } from "./updates.js";
import { WebAccessService } from "./web-access.js";
import { popupWindowMenu, restoreWindowBounds, titleBarOverlay, windowBackground } from "./window-chrome.js";
import { loadWindowState, saveWindowState, type WindowState } from "./window-state.js";
import { publicWorkbenchFolders } from "./workbench-folders.js";
import { createDesktopWorkerPool } from "./worker-pool.js";

const here = dirname(fileURLToPath(import.meta.url));
declare const __VERA_DEV__: boolean;
declare const __VERA_TEST__: boolean;
declare const __VERA_SESSION_PERF__: boolean;
if (__VERA_SESSION_PERF__) installSessionPerformance();
declare const __VERA_UPDATE_URL__: string;
/** The default plugin catalog folder (build input VERA_PLUGIN_CATALOG_URL); empty when none. */
declare const __VERA_PLUGIN_CATALOG_URL__: string;
/** The catalog signing public key (build input VERA_PLUGIN_CATALOG_KEY); remote indexes must verify with it. */
declare const __VERA_PLUGIN_CATALOG_KEY__: string;
declare const __VERA_SIGNED__: boolean;
app.setName(__VERA_TEST__ ? "VERA Test" : "VERA");
// Datasheet CDNs can reject Chromium HTTP/2 streams, so downloads stay on HTTP/1.1. Chromium offers the
// switch only for the whole process: catalog, plugin program and update requests lose HTTP/2 multiplexing
// too, which costs a little speed and no function. Model calls use Node's network stack, not this one.
app.commandLine.appendSwitch("disable-http2");
installSessionPolicy(app);
// pi-ai's public standalone entrypoint makes its variable OAuth imports available in bundles.
registerBunOAuthFlows();
const userData = app.commandLine.getSwitchValue("user-data-dir");
const dataLocations = configureDataLocations(app, process.execPath, userData);
// Electron keys the lock on the user data folder, so it follows the data locations. A second instance
// leaves here, before it opens the first one's stores, key files, workers or native modules.
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.exit(0);

protocol.registerSchemesAsPrivileged([
  { scheme: "vera", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let window: BrowserWindow | undefined;
nativeTheme.on("updated", () => {
  if (!window || window.isDestroyed()) return;
  window.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors));
  window.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors));
});
// IPC waits for this before dispatch: responses are redacted with every stored secret. It never rejects;
// a credential file that fails to load leaves credential operations failing, not the window (PERF-11).
let credentialsReady: Promise<void> = Promise.resolve();
const fileWorkers = createDesktopWorkerPool();
const pluginListings = new PluginListingHost(join(dataLocations.paths.userData, "plugins"));
const downloadTransfer = createDesktopDownloadTransfer();
const models = app.isPackaged
  ? join(process.resourcesPath, "models")
  : join(here, "../../../../../src/models");
const manifest = app.isPackaged
  ? join(process.resourcesPath, "model-manifest.json")
  : join(models, "model-manifest.json");
/** App help pages, read-only: <resources>/help when packaged, 05_Software/help in development. */
const help = new HelpLibrary(
  app.isPackaged ? join(process.resourcesPath, "help") : join(here, "../../../../../help"),
);
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
  (envelope) => {
    if (envelope.topic === "workbench" && envelope.event.type === "index.document") {
      const event = envelope.event;
      return {
        ...envelope,
        event: {
          ...event,
          path: display.path(envelope.id, event.path),
          document: event.document ? display.document(envelope.id, event.document) : null,
        },
      };
    }
    if (envelope.topic === "workbench" && envelope.event.type === "index.guard")
      return {
        ...envelope,
        event: {
          ...envelope.event,
          guard: publicGuard(envelope.event.guard, (text) => display.scrub(envelope.id, text)),
        },
      };
    return sanitizeEvent(
      envelope,
      (text) => (envelope.topic === "session" ? sessionContent(text) : credentials.scrub(text)),
      (text) => credentials.scrub(text),
    );
  },
);
const logger = createLogger(dataLocations.paths.logs, systemClock);
const credentials = new CredentialFile({
  file: join(dataLocations.paths.userData, "credentials.json"),
  files: createFileAccess(systemClock),
  crypto: safeStorage,
  logger,
  platform: process.platform,
});
let announcedSettings: Settings | undefined;
const settings = new SettingsService({
  files: createFileAccess(systemClock),
  paths: dataLocations.paths,
  uuid: randomUUID,
  changed: () => {
    // Compared with the settings last announced, so a theme or layout change keeps open documents.
    const next = settings.get().settings;
    emitAppEvent({ topic: "app", id: "app", event: settingsChangedEvent(announcedSettings, next) });
    announcedSettings = next;
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
      if (event.event.type === "closed") display.close();
      emitAppEvent(eventEnvelopeSchema.parse(event));
    },
  },
  indexer.processor,
);
const maskingFor = createMaskingResolver(() => settings.get().settings);
function sessionContent(text: string): string {
  return maskingFor(workbench.getSnapshot().config, "agent") ? credentials.scrub(text) : text;
}
const display = new DisplayDocuments(
  workbench,
  maskingFor,
  (text) => credentials.scrub(text),
  new DisplayIdentities(
    loadDisplayIdentityKey(join(dataLocations.paths.userData, "display-identities.json"), (event) =>
      logger.log("warn", event),
    ),
  ),
  () => credentials.knownSecrets(),
);
/** Installed plugins live under userData; enablement is per workbench (workbench.yaml). */
const plugins = new PluginStore({ root: join(dataLocations.paths.userData, "plugins") });
const processHost = createDesktopProcessHost();
const terminals = new TerminalService({
  current: () => {
    const snapshot = workbench.getSnapshot();
    return { id: snapshot.config.id, folder: snapshot.folder };
  },
  shell: createCommandShellHost(
    processHost,
    () => settings.get().settings.shell,
    (text) => credentials.scrub(text),
  ),
  pty: createPtyFactory(
    processHost,
    app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked/node_modules/node-pty") : "node-pty",
  ),
  scrub: (text) => credentials.scrub(text),
  secrets: () => credentials.knownSecrets(),
  maskUserOutput: () => maskingFor(workbench.getSnapshot().config, "runs"),
  maskAgentOutput: () => maskingFor(workbench.getSnapshot().config, "agent"),
});
/** Plugin program runs; session stop, workbench close and app exit kill their process trees. */
const programs = new ProgramRunner({
  host: processHost,
  clock: systemClock,
  // Bench resources are leased in the per-user folder the CLI also uses (spec REQ-DATA-f2cbfc23 §5).
  leases: new ResourceLeases({
    root: leaseRoot({
      platform: process.platform,
      env: process.env,
      tmpdir: tmpdir(),
      uid: process.getuid?.(),
    }),
    app: "desktop",
  }),
});
/** The pinned uv of the package, or the one prepare:uv placed in the source tree for development. */
const uvBinary = join(
  app.isPackaged
    ? join(process.resourcesPath, "uv")
    : join(here, "../../../../../src/uv", pluginPlatform(process.platform, process.arch) ?? "unsupported"),
  process.platform === "win32" ? "uv.exe" : "uv",
);
/** Installs programs only on plugins.provision; resolves them for sessions without installing anything. */
function createProvisioner(store: PluginStore): Provisioner {
  return new Provisioner({
    store,
    root: join(dataLocations.paths.userData, "plugins", "runtime"),
    ...(existsSync(uvBinary) ? { uv: { executable: uvBinary } } : {}),
    host: processHost,
    clock: systemClock,
    platform: pluginPlatform(process.platform, process.arch),
    fetch: (url, { signal }) => net.fetch(url, signal ? { signal } : {}),
    settings: () => settings.get().settings.plugins,
  });
}
const provisioner = createProvisioner(plugins);
const scopedProvisioners = new ProvisionerHosts(createProvisioner);
/** The official plugins as a catalog release: <resources>/plugins, or prepare:plugins in development. */
const bundledPlugins =
  __VERA_TEST__ && process.env.VERA_TEST_BUNDLED_PLUGINS !== undefined
    ? process.env.VERA_TEST_BUNDLED_PLUGINS || undefined
    : app.isPackaged
      ? join(process.resourcesPath, "plugins")
      : join(here, "../../../../../../07_Delivery/plugins");
/** The catalog folder from settings, else the build default; the bundled release stands in without one. */
const catalogLocation = () =>
  settings.get().settings.plugins?.catalog ?? (__VERA_PLUGIN_CATALOG_URL__ || undefined);
/** The plugin catalog: verified downloads for review, installs only on the user's action. */
const catalog = new PluginCatalog({
  store: plugins,
  root: join(dataLocations.paths.userData, "plugins", "catalog"),
  location: catalogLocation,
  channel: () => settings.get().settings.plugins?.channel,
  // Test builds may pin a throwaway key, so end-to-end tests can sign a loopback catalog.
  publicKey:
    __VERA_TEST__ && process.env.VERA_TEST_CATALOG_KEY !== undefined
      ? process.env.VERA_TEST_CATALOG_KEY
      : __VERA_PLUGIN_CATALOG_KEY__,
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
  await terminals.closeAll();
  let folder: string;
  try {
    folder = workbench.getSnapshot().folder;
  } catch {
    return;
  }
  await programs.stopWorkbench(folder);
}
/** Refuse terminal authority while asynchronous workbench replacement still owns the old snapshot. */
async function terminalTransition<T>(operation: () => Promise<T>): Promise<T> {
  terminals.suspend();
  try {
    return await operation();
  } finally {
    terminals.resume();
  }
}
const providers = new ProviderSettings(settings, credentials);
const partsAccess = new PartsAccessService({
  settings,
  credentials,
  changed: () => emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } }),
});
const mqttCredentials = new PluginCredentialService("mqtt", {
  credentials,
  changed: () => emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } }),
});
const wokwiCredentials = new PluginCredentialService("wokwi", {
  credentials,
  changed: () => emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } }),
});
const webAccess = new WebAccessService({
  settings,
  credentials,
  changed: () => {
    // Web access gates parts search too: a change ends supplier calls in flight.
    partsAccess.revoke();
    emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } });
  },
});
let chatgpt = new ChatgptAuth({
  settings,
  credentials,
  openExternal: async (url) => {
    await openExternal({ url, confirmed: true }, (url) => shell.openExternal(url), true);
  },
});
let modelGateway = new ProviderGateway(settings, credentials, providers, systemClock);
/** The interface language the user sees: the setting, else the system locale, else English. */
function interfaceLanguage(): HelpLanguage {
  const language = settings.get().settings.language;
  return language !== "system"
    ? language
    : (helpLanguages.find((code) => app.getLocale().startsWith(code)) ?? "en");
}
const sessions = new SessionsHost({
  log: (message) => logger.log("error", "agent.turn.failed", { message }),
  terminals: (workbenchId) => terminals.reader(workbenchId),
  help: { app: help, language: interfaceLanguage },
  pluginBuilder: plugins,
  managedRoots: [dataLocations.paths.userData],
  web: webAccess.provider,
  parts: partsAccess.provider,
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
    shell: createCommandShellHost(
      processHost,
      () => settings.get().settings.shell,
      (text) => credentials.scrub(text),
    ),
    // Approved runs of official plugins (mqtt-tools, wokwi) read their stored credentials here (spec REQ-DATA-96d18686 §1).
    credentials: programCredentials(credentials),
    resolver:
      __VERA_TEST__ && process.env.VERA_TEST_PROGRAMS
        ? testProgramResolver(process.env.VERA_TEST_PROGRAMS)
        : provisioner,
  },
  ...(__VERA_TEST__ && process.env.VERA_TEST_ALLOW_WRITES === "1"
    ? { permissions: { allow: () => true } }
    : {}),
});
ipcMain.handle("vera:subscription", async (event, action, payload) => {
  await credentialsReady;
  return sessions.subscription(event, action, payload);
});
/** The folder of the open workbench when `workbenchId` names it; CONFLICT otherwise. */
function openWorkbenchFolder(workbenchId: string): string {
  const snapshot = workbench.getSnapshot();
  if (snapshot.config.id !== workbenchId) throw veraError("CONFLICT");
  return snapshot.folder;
}
/** The help pages of the installed plugins without issues that ship help, by title (REQ-FUNC-559bba00). */
async function pluginHelpPages(language: HelpLanguage): Promise<HelpPageSummary[]> {
  const store = activePluginStore();
  const pages: HelpPageSummary[] = [];
  for (const plugin of await store.list()) {
    if (plugin.issues.length || !plugin.composition?.help?.length) continue;
    try {
      const { page, title, language: served } = await pluginHelpPage(plugin.id, language, store);
      pages.push({ page, title, language: served, plugin: plugin.id });
    } catch {}
  }
  return pages.sort((a, b) => a.title.localeCompare(b.title, language));
}
async function pluginHelpPage(
  id: string,
  language: HelpLanguage,
  store = activePluginStore(),
): Promise<HelpPage> {
  let folder: string;
  try {
    folder = (await store.load(id)).folder;
  } catch {
    throw veraError("NOT_FOUND");
  }
  const found = await readPluginHelp(folder, language);
  if (!found) throw veraError("NOT_FOUND");
  return { page: id, plugin: id, ...found };
}
/** Workbench-bound view for user plugin actions; explicit ids reject stale windows. */
function activePluginStore(workbenchId?: string): PluginStore {
  if (workbenchId) return plugins.forWorkbench(openWorkbenchFolder(workbenchId));
  try {
    return plugins.forWorkbench(workbench.getSnapshot().folder);
  } catch {
    return plugins;
  }
}
const runPresentation = new RunPresentation({
  current: () => workbench.getSnapshot(),
  maskingFor,
  scrub: (text) => credentials.scrub(text),
  runner: programs,
});
/** A native save dialog. Exports open it outside the session queue: held inside, an open dialog stalls every session call and the quit drain. */
async function chooseSavePath(options: SaveDialogOptions): Promise<string | null> {
  if (__VERA_TEST__ && process.env.VERA_TEST_DIALOG_PATH) return process.env.VERA_TEST_DIALOG_PATH;
  if (!window || window.isDestroyed()) return null;
  const result = await dialog.showSaveDialog(window, options);
  return result.canceled ? null : (result.filePath ?? null);
}
/** `id` limits the forgotten program resolutions to that plugin; found programs stay stored by file stamp. */
function pluginsChanged(id?: string): void {
  provisioner.invalidate(id);
  sessions.invalidatePrograms();
}
/** Reads the enabled plugins' program statuses in the background, so later reads and runs find a warm cache. */
function warmPrograms(snapshot: WorkbenchSnapshot): WorkbenchSnapshot {
  const store = plugins.forWorkbench(snapshot.folder);
  for (const id of snapshot.config.plugins.enabled)
    void scopedProvisioners.run(store, (host) => host.statuses(id, undefined, provisioner)).catch(() => {});
  return snapshot;
}

/** The first message of an open workbench loads its embedding model in the indexer (PERF-11). */
const embeddingWarmup = createEmbeddingWarmup({
  hasVectors: (workbenchId) =>
    workbench.readDocuments(workbenchId, async (root, db) =>
      db.prepare("SELECT 1 FROM embeddings WHERE model_id=? LIMIT 1").get(indexer.embeddings.modelId)
        ? root
        : undefined,
    ),
  embed: (root, signal) => indexer.embeddings.embed(root, ["warm-up"], signal),
});

// Programs that open Docs tree entries, detected once per start on first use (TASK-eae3a69e).
let detected: Map<OpenerId, Opener> | undefined;
const openers = () =>
  (detected ??= detectOpeners({ platform: process.platform, env: process.env, exists: pathExists }));
/** Linux applications registered for a file type (TASK-c49f03d5); the UI language picks their names. */
const systemAppDeps = (): SystemAppDeps => {
  return {
    platform: process.platform,
    run: runTool,
    dataDirs: [
      process.env.XDG_DATA_HOME || join(app.getPath("home"), ".local", "share"),
      ...(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean),
    ],
    readText: readOptionalText,
    // The names follow the UI language, which falls back to English like the renderer does.
    lang: interfaceLanguage(),
    openers: openers(),
  };
};
ipcMain.handle(
  "vera:invoke",
  createInvokeRouter({
    target: () =>
      window && !window.isDestroyed() ? { webContents: window.webContents, url: rendererUrl } : undefined,
    handlers: {
      "terminal.list": ({ workbenchId }) => terminals.list(workbenchId),
      "terminal.create": ({ workbenchId, cols, rows }) => terminals.create(workbenchId, cols, rows),
      "terminal.output": ({ workbenchId, id }) => terminals.output(workbenchId, id),
      "terminal.input": ({ workbenchId, id, data }) => {
        terminals.input(workbenchId, id, data);
        return {};
      },
      "terminal.resize": ({ workbenchId, id, cols, rows }) => {
        terminals.resize(workbenchId, id, cols, rows);
        return {};
      },
      "terminal.consent": ({ workbenchId, id, shared }) => terminals.consent(workbenchId, id, shared),
      "terminal.close": async ({ workbenchId, id }) => {
        await terminals.close(workbenchId, id);
        return {};
      },
      "web.access.get": () => webAccess.get(),
      "web.access.save": (request) => webAccess.save(request),
      "web.access.removeKey": (request) => webAccess.removeKey(request),
      "web.access.test": (request) => webAccess.test(request),
      "web.access.cancel": (request) => webAccess.cancelTest(request),
      "parts.access.get": () => partsAccess.get(),
      "parts.access.save": (request) => partsAccess.save(request),
      "parts.access.removeKey": (request) => partsAccess.removeKey(request),
      "parts.access.test": (request) => partsAccess.test(request),
      "parts.access.cancel": (request) => partsAccess.cancelTest(request),
      "mqtt.credentials.list": () => mqttCredentials.list(),
      "mqtt.credentials.save": (request) => mqttCredentials.save(request),
      "mqtt.credentials.remove": (request) => mqttCredentials.remove(request),
      "wokwi.credentials.list": () => wokwiCredentials.list(),
      "wokwi.credentials.save": (request) => wokwiCredentials.save(request),
      "wokwi.credentials.remove": (request) => wokwiCredentials.remove(request),
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
        const snapshot = workbenchId ? workbench.getSnapshot() : undefined;
        if (workbenchId && snapshot?.config.id !== workbenchId) throw veraError("CONFLICT");
        const database = snapshot ? workbench.getDatabase() : undefined;
        const list = await pluginListings.list(snapshot?.folder);
        if (
          snapshot &&
          (workbench.getSnapshot().config.id !== snapshot.config.id ||
            workbench.getSnapshot().folder !== snapshot.folder ||
            workbench.getDatabase() !== database)
        )
          throw veraError("CONFLICT");
        const enabled = workbenchId ? workbench.enabledPlugins(workbenchId) : [];
        return list.map((plugin) => ({ ...plugin, enabled: enabled.includes(plugin.id) }));
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
      "plugins.scopedReview": ({ workbenchId, id }) => activePluginStore(workbenchId).reviewScoped(id),
      "plugins.scopedTrust": async ({ workbenchId, id, sha256 }) => {
        const installed = await activePluginStore(workbenchId).trustScoped(id, sha256);
        pluginsChanged(id);
        return installed;
      },
      "plugins.install": async ({ path, sha256 }) => {
        const installed = await plugins.install(path, sha256);
        pluginsChanged(installed.id);
        return installed;
      },
      "plugins.promote": async ({ id, sha256 }) => {
        const installed = await plugins.promote(id, sha256);
        pluginsChanged(id);
        return installed;
      },
      "plugins.export": async ({ id, sha256 }) => {
        const bytes = await plugins.export(id, sha256);
        if (!window || window.isDestroyed()) return { path: null };
        const selected = await dialog.showSaveDialog(window, {
          defaultPath: `${id}.zip`,
          filters: [{ name: "Zip", extensions: ["zip"] }],
        });
        if (selected.canceled || !selected.filePath) return { path: null };
        await writeFile(selected.filePath, bytes);
        return { path: selected.filePath };
      },
      "plugins.uninstall": async ({ id }) => {
        await plugins.uninstall(id);
        pluginsChanged(id);
        return {};
      },
      "plugins.toggle": async ({ workbenchId, id, enabled }) => {
        const result = await workbench.togglePlugin(workbenchId, id, enabled);
        pluginsChanged(id);
        return result;
      },
      "plugins.catalog": ({ refresh }) => catalog.view({ refresh }),
      "plugins.catalogReview": ({ id }) => catalog.review(id),
      "plugins.catalogPreview": ({ id }) => catalog.preview(id),
      "plugins.catalogInstall": async ({ id, sha256 }) => {
        const installed = await catalog.install(id, sha256);
        pluginsChanged(id);
        return installed;
      },
      "plugins.programs": async ({ id, workbenchId }) =>
        runPresentation.statuses(
          () =>
            workbenchId
              ? scopedProvisioners.run(activePluginStore(workbenchId), (host) =>
                  host.statuses(id, undefined, provisioner),
                )
              : provisioner.statuses(id),
          workbenchId,
        ),
      "plugins.check": async ({ id, workbenchId }) => {
        const statuses = await runPresentation.statuses(
          () =>
            workbenchId
              ? scopedProvisioners.run(activePluginStore(workbenchId), (host) =>
                  host.check(id, undefined, provisioner),
                )
              : provisioner.check(id),
          workbenchId,
        );
        sessions.invalidatePrograms();
        return statuses;
      },
      "plugins.installArchive": async ({ id, program, sha256, workbenchId }) => {
        const before = workbenchId ? workbench.getSnapshot() : undefined;
        const beforeDb = workbenchId ? workbench.getDatabase() : undefined;
        const store = workbenchId ? activePluginStore(workbenchId) : plugins;
        const validate = async () => {
          if (
            before &&
            (workbench.getSnapshot().config.id !== before.config.id ||
              workbench.getSnapshot().folder !== before.folder ||
              workbench.getDatabase() !== beforeDb)
          )
            throw veraError("CONFLICT");
          const current = await store.load(id).catch(() => {
            throw veraError("CONFLICT");
          });
          if (current.record.sha256 !== sha256) throw veraError("CONFLICT");
          const item = current.manifest.programs[program];
          const platform = pluginPlatform(process.platform, process.arch);
          if (!item || !("download" in item.install) || !platform || !item.install.download?.[platform])
            throw veraError("INVALID");
          await current.verify?.();
        };
        await validate();
        if (!window || window.isDestroyed()) return null;
        const selected =
          __VERA_TEST__ && process.env.VERA_TEST_DEPENDENCY_ARCHIVE
            ? { canceled: false, filePaths: [process.env.VERA_TEST_DEPENDENCY_ARCHIVE] }
            : await dialog.showOpenDialog(window, {
                properties: ["openFile"],
                filters: [{ name: "Dependency archive", extensions: ["*"] }],
              });
        if (selected.canceled || !selected.filePaths[0]) return null;
        await validate();
        try {
          return await runPresentation.statuses(
            () =>
              workbenchId
                ? scopedProvisioners.run(store, (host) =>
                    host.installArchive(
                      id,
                      program,
                      selected.filePaths[0] as string,
                      sha256,
                      undefined,
                      provisioner,
                    ),
                  )
                : provisioner.installArchive(id, program, selected.filePaths[0] as string, sha256),
            workbenchId,
          );
        } finally {
          pluginsChanged(id);
        }
      },
      "plugins.provision": async ({ id, workbenchId }) => {
        try {
          return await runPresentation.statuses(
            () =>
              workbenchId
                ? scopedProvisioners.run(activePluginStore(workbenchId), (host) =>
                    host.install(id, undefined, provisioner),
                  )
                : provisioner.install(id),
            workbenchId,
          );
        } finally {
          pluginsChanged(id);
        }
      },
      "plugins.reinstall": async ({ id, workbenchId }) => {
        try {
          return await runPresentation.statuses(
            () =>
              workbenchId
                ? scopedProvisioners.run(activePluginStore(workbenchId), (host) =>
                    host.reinstall(id, undefined, provisioner),
                  )
                : provisioner.reinstall(id),
            workbenchId,
          );
        } finally {
          pluginsChanged();
        }
      },
      // Parameter states from the stores behind the moved Settings pages: references and supplier ids, never a
      // secret (REQ-FUNC-cbdb46ac). Workbench files are checked in the open workbench only.
      "plugins.configuration": async ({ workbenchId, plugins: declared }) => {
        const snapshot = workbenchId ? workbench.getSnapshot() : undefined;
        if (workbenchId && snapshot?.config.id !== workbenchId) throw veraError("CONFLICT");
        const scopes = new Map<string, Promise<readonly string[]>>();
        const secrets = (scope: "mqtt" | "wokwi" | "parts") => {
          let refs = scopes.get(scope);
          if (!refs) {
            refs =
              scope === "parts"
                ? partsAccess.get().then((access) =>
                    Object.entries(access.keys)
                      .filter(([, key]) => key?.keyConfigured)
                      .map(([supplier]) => supplier),
                  )
                : (scope === "mqtt" ? mqttCredentials : wokwiCredentials)
                    .list()
                    .then((list) => list.credentials.map((entry) => entry.ref));
            scopes.set(scope, refs);
          }
          return refs;
        };
        return {
          plugins: await Promise.all(
            declared.map(async ({ key, settings }) => ({
              key,
              settings: await settingStates(settings, { workbench: snapshot?.folder, secrets }),
            })),
          ),
        };
      },
      "runs.list": ({ workbenchId }) => runPresentation.list(workbenchId),
      "runs.log": ({ workbenchId, id, full }) => runPresentation.log(workbenchId, id, full),
      "runs.stop": async ({ workbenchId, id }) => {
        await programs.stopRun(openWorkbenchFolder(workbenchId), id);
        return {};
      },
      "docs.list": ({ workbenchId }) => display.list(workbenchId),
      "docs.tree": ({ workbenchId, path }) => display.tree(workbenchId, path),
      "docs.find": ({ workbenchId, query }) => display.find(workbenchId, query),
      "docs.read": ({ workbenchId, path, requestId }) => display.read(workbenchId, path, requestId),
      "docs.readBytes": ({ workbenchId, path, offset, length, revision }) =>
        display.readBytes(workbenchId, path, offset, length, revision),
      "docs.stat": ({ workbenchId, path }) => display.stat(workbenchId, path),
      // The Docs tree's OS actions go through the tree's confinement first (TASK-eae3a69e).
      "docs.openers": () => ({ apps: [...openers().keys()] }),
      "docs.openWith": ({ workbenchId, path, app }) =>
        openWith(
          () => workbench.locateEntry(workbenchId, display.resolve(workbenchId, path)),
          app,
          openers(),
          launchDetached,
        ),
      "docs.systemApps": async ({ workbenchId, path }) => ({
        apps: (
          await systemApps(
            () => workbench.locateEntry(workbenchId, display.resolve(workbenchId, path)),
            systemAppDeps(),
          )
        ).map(({ id, name }) => ({ id, name })),
      }),
      "docs.openSystemApp": ({ workbenchId, path, app }) =>
        openSystemApp(
          () => workbench.locateEntry(workbenchId, display.resolve(workbenchId, path)),
          app,
          systemAppDeps(),
          launchDetached,
        ),
      "docs.reveal": ({ workbenchId, path }) =>
        revealEntry(
          () => workbench.locateEntry(workbenchId, display.resolve(workbenchId, path)),
          (absolute) => shell.showItemInFolder(absolute),
        ),
      "docs.copyPath": ({ workbenchId, path, form }) =>
        copyEntry(
          () => workbench.locateEntry(workbenchId, display.resolve(workbenchId, path)),
          display.resolve(workbenchId, path),
          form,
          (text) => clipboard.writeText(text),
          sep,
        ),
      "docs.volume": async ({ workbenchId }) => ({
        workbenchId,
        volume: workbench.documentVolume(workbenchId),
        guard: display.guard(workbenchId),
      }),
      "docs.approve": async ({ workbenchId, files }) => {
        await workbench.approveDocuments(workbenchId, files);
        return {};
      },
      "docs.search": ({ workbenchId, query }) => display.search(workbenchId, query),
      "docs.open": (request) =>
        display.open(
          request.workbenchId,
          () =>
            "sessionId" in request
              ? sessions.run((service) =>
                  workbench.readDocuments(request.workbenchId, () =>
                    service.openCitation(request.sessionId, request.messageId, request.ref),
                  ),
                )
              : workbench.openDocument(
                  request.workbenchId,
                  "path" in request
                    ? display.resolve(request.workbenchId, request.path)
                    : display.resolveRef(request.workbenchId, request.ref),
                  "path" in request,
                ),
          request,
          request.requestId,
        ),
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
          s
            .listArtifacts(sessionId)
            .map((a) =>
              publicArtifact(a, (text) =>
                maskingFor(workbench.getSnapshot().config, "exports") ? credentials.scrub(text) : text,
              ),
            ),
        ),
      "artifacts.open": ({ artifactId }) =>
        sessions.run(async (s) =>
          publicArtifact(await s.openArtifact(artifactId), (text) =>
            maskingFor(workbench.getSnapshot().config, "exports") ? credentials.scrub(text) : text,
          ),
        ),
      "artifacts.reveal": ({ artifactId }) =>
        sessions.run((s) => revealArtifact(s, artifactId, (path) => shell.showItemInFolder(path))),
      "artifacts.export": async ({ artifactId }) => {
        const owner = workbench.getSnapshot().config.id;
        const name = await sessions.run((s) => exportName(s, artifactId, (text) => credentials.scrub(text)));
        const path = await chooseSavePath({ defaultPath: name });
        if (path === null) return { exported: false };
        return sessions.run((s) => {
          if (workbench.getSnapshot().config.id !== owner) throw veraError("CONFLICT");
          return exportArtifact(s, artifactId, {
            masking: () => maskingFor(workbench.getSnapshot().config, "exports"),
            root: workbench.getSnapshot().folder,
            choose: async () => path,
            write: (target, content) => createFileAccess(systemClock).writeAtomic(target, content),
            scrub: (text) => credentials.scrub(text),
          });
        });
      },
      "changes.list": ({ sessionId }) =>
        sessions.run((s) => s.listChanges(sessionId).map((c) => ({ ...c, path: credentials.scrub(c.path) }))),
      "changes.get": ({ changeId }) =>
        sessions.run((s) => {
          const c = s.getChange(changeId);
          return { ...c, path: credentials.scrub(c.path), diff: credentials.scrub(c.diff) };
        }),
      "app.revealPath": ({ path }) =>
        sessions.run(() =>
          revealPath(
            workbench.getSnapshot().folder,
            display.resolve(workbench.getSnapshot().config.id, path),
            (absolute) => shell.showItemInFolder(absolute),
          ),
        ),
      "app.openPath": ({ path }) =>
        sessions.run(() =>
          openPath(
            workbench.getSnapshot().folder,
            display.resolve(workbench.getSnapshot().config.id, path),
            (absolute) => shell.openPath(absolute),
          ),
        ),
      "session.list": async ({ workbenchId }) => {
        const current = workbench.getSnapshot(),
          db = workbench.getDatabase();
        const rows = await sessions.list(workbenchId);
        if (
          workbench.getSnapshot().config.id !== current.config.id ||
          workbench.getSnapshot().folder !== current.folder ||
          workbench.getDatabase() !== db
        )
          throw veraError("CONFLICT");
        return sessionOrder.list(
          current.config.id,
          rows.map((item) => sanitizeSessionSummary(item, sessionContent)),
        );
      },
      "session.move": ({ workbenchId, sessionId, offset }) =>
        sessions.run(async (s) => {
          if (workbench.getSnapshot().config.id !== workbenchId) throw veraError("CONFLICT");
          await sessionOrder.move(workbenchId, s.list(), sessionId, offset);
          return {};
        }),
      "session.sizes": ({ workbenchId }) =>
        sessions.run((s) => {
          if (workbench.getSnapshot().config.id !== workbenchId) throw veraError("CONFLICT");
          return s.sizes();
        }),
      "session.search": ({ query, workbenchId }) =>
        sessions.run((s) => {
          if (workbenchId && workbench.getSnapshot().config.id !== workbenchId) throw veraError("CONFLICT");
          return s.search(query).map((item) => sanitizeSessionSummary(item, sessionContent));
        }),
      "session.export": async ({ sessionId, format }) => {
        const owner = workbench.getSnapshot().config.id;
        // An unknown session is refused before the dialog opens.
        await sessions.run((s) => {
          s.get(sessionId);
        });
        const path = await chooseSavePath({
          defaultPath: `${sessionId}.${format}`,
          filters: [{ name: format === "md" ? "Markdown" : "JSON", extensions: [format] }],
        });
        if (path === null) return { exported: false };
        return sessions.run((s) => {
          if (workbench.getSnapshot().config.id !== owner) throw veraError("CONFLICT");
          return exportSession(s, sessionId, format, {
            masking: () => maskingFor(workbench.getSnapshot().config, "exports"),
            root: workbench.getSnapshot().folder,
            choose: async () => path,
            write: (target, content) => createFileAccess(systemClock).writeAtomic(target, content),
            scrub: (text) => credentials.scrub(text),
          });
        });
      },
      "session.create": ({ modelRef, mode, workbenchId, reuseEmpty }) =>
        sessions.run((s) => {
          if (workbenchId && workbench.getSnapshot().config.id !== workbenchId) throw veraError("CONFLICT");
          if (credentials.containsSecret(modelRef)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          return sanitizeSessionSummary(s.create(modelRef, mode, reuseEmpty), (text) => sessionContent(text));
        }),
      "session.revision": ({ sessionId }) => sessions.run((service) => service.revision(sessionId)),
      "session.get": ({ sessionId }) =>
        sessions.run((s) => {
          const value = s.get(sessionId);
          return {
            ...value,
            snapshot: rendererSessionSnapshot(value.snapshot, sessionContent),
          };
        }),
      "session.item.detail": ({ sessionId, itemId, field }) =>
        sessions.run((s) => ({ text: sessionContent(s.itemDetail(sessionId, itemId, field)) })),
      "session.bookmark": ({ sessionId, messageId, bookmarked }) =>
        sessions.run((s) => {
          s.bookmark(sessionId, messageId, bookmarked);
          return {};
        }, false),
      "session.rename": ({ sessionId, title }) =>
        sessions.run((s) => {
          if (credentials.containsSecret(title)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          return sanitizeSessionSummary(s.rename(sessionId, title), sessionContent);
        }),
      "session.archive.set": ({ sessionId, archived }) =>
        sessions.run((s) => sanitizeSessionSummary(s.setArchived(sessionId, archived), sessionContent)),
      "session.delete": ({ sessionId }) =>
        sessions.run(async (s) => {
          await s.delete(sessionId);
          return {};
        }),
      "session.send": ({ sessionId, text, images }) =>
        sessions.run(async (s) => {
          if (credentials.containsSecret(text)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          const sent = images?.length
            ? await s.sendWithImages(sessionId, text, images)
            : s.send(sessionId, text);
          embeddingWarmup.request(workbench.getSnapshot().config.id);
          return sent;
        }),
      // Stop and approval decisions must not wait for plugin loading and program probing.
      "session.stop": ({ sessionId }) => {
        return sessions.run((s) => ({ stopped: s.stop(sessionId) }), false);
      },
      "session.approval.decide": (request) =>
        sessions.run(async (s) => {
          if (request.commandPrefix !== undefined) await s.allowCommandApproval(request);
          else s.decideApproval(request);
          return {};
        }, false),
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
          return sanitizeSessionSummary(s.setModel(sessionId, modelRef), sessionContent);
        }),
      "session.mode.set": ({ sessionId, mode }) =>
        sessions.run((s) => sanitizeSessionSummary(s.setMode(sessionId, mode), sessionContent)),
      "providers.discover": (request) => modelGateway.discover(request),
      "providers.models": ({ id }) => modelGateway.models(id),
      "providers.test": ({ id, model }) => modelGateway.test(id, model),
      "providers.list": () => providers.list(),
      "providers.save": async (request) => {
        const result = await providers.save(request);
        // A replaced key leaves the settings as they were; shown documents still have to mask it.
        if (request.apiKey && result.status === "saved")
          emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } });
        return result;
      },
      "providers.remove": (request) => providers.remove(request),
      "app.info": () => getAppInfo(dataLocations.portable),
      "help.list": async ({ language }) => [
        ...(await help.list(language)),
        ...(await pluginHelpPages(language)),
      ],
      "help.read": (request) =>
        "plugin" in request
          ? pluginHelpPage(request.plugin, request.language)
          : help.read(request.page, request.language),
      "window.menu": (request) => popupWindowMenu(window, request, app.isPackaged),
      "commands.shells": () => detectCommandShells(processHost),
      "app.settings.get": () => {
        const snapshot = settings.get();
        if (credentials.containsSecret(snapshot)) throw { code: "INVALID", messageKey: "errors.INVALID" };
        return snapshot;
      },
      "app.settings.update": async (patch) => {
        if (credentials.containsSecret(patch)) throw { code: "INVALID", messageKey: "errors.INVALID" };
        const result = await settings.update(patch);
        nativeTheme.themeSource = result.settings.theme;
        // The package index and proxy reach uv-run programs through their resolved environment.
        if (patch.plugins) pluginsChanged();
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
      "workbench.scanDocs": ({ folder, gitignore }) => workbench.scanDocuments(folder, gitignore),
      "workbench.previewDocs": async ({ folder, ...docs }) => {
        const preview = await workbench.previewDocuments(folder, docs);
        return { ...preview, guard: publicGuard(preview.guard, (text) => credentials.scrub(text)) };
      },
      "workbench.relativeFolder": async ({ root, folder }) => ({
        path: await workbench.relativeFolder(root, folder),
      }),
      "workbench.create": ({ folder, name, config, instructions }) =>
        sessions.lifecycle(() =>
          terminalTransition(async () => {
            embeddingWarmup.cancel();
            await stopWorkbenchPrograms();
            return publicWorkbenchFolders(
              warmPrograms(
                await workbench.create(folder, name, {
                  ...(config ? { config } : {}),
                  ...(instructions !== undefined ? { instructions } : {}),
                }),
              ),
              (text) => credentials.scrub(text),
            );
          }),
        ),
      "workbench.open": ({ folder }) =>
        sessions.lifecycle(() =>
          terminalTransition(async () => {
            embeddingWarmup.cancel();
            await stopWorkbenchPrograms();
            return publicWorkbenchFolders(warmPrograms(await workbench.open(folder)), (text) =>
              credentials.scrub(text),
            );
          }),
        ),
      "workbench.close": async () => {
        await sessions.lifecycle(() =>
          terminalTransition(async () => {
            embeddingWarmup.cancel();
            await stopWorkbenchPrograms();
            await workbench.close();
          }),
        );
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
      "workbench.config.get": async () =>
        publicWorkbenchFolders(
          {
            ...(await workbench.getConfig()),
            readOnly: workbench.getSnapshot().readOnly,
            folder: workbench.getSnapshot().folder,
          },
          (text) => credentials.scrub(text),
        ),
      "workbench.storage": ({ workbenchId }) => workbench.storageSize(workbenchId),
      "workbench.config.update": ({
        patch,
        workbenchId,
        removeCommandPrefixes,
        addAdditionalFolders,
        removeAdditionalFolders,
      }) =>
        workbench
          .updateConfig(workbenchPatchSchema.parse(patch), workbenchId, removeCommandPrefixes, {
            ...(addAdditionalFolders ? { add: addAdditionalFolders } : {}),
            ...(removeAdditionalFolders ? { remove: removeAdditionalFolders } : {}),
          })
          .then((value) => publicWorkbenchFolders(value, (text) => credentials.scrub(text))),
      "workbench.additionalFolders.list": async ({ workbenchId }) =>
        (await workbench.listAdditionalFolders(workbenchId)).map(({ id, path }) => ({
          id,
          label: credentials.scrub(path),
        })),
      "workbench.additionalFolders.choose": async ({ workbenchId }) => {
        let path: string | undefined;
        if (__VERA_TEST__ && process.env.VERA_TEST_DIALOG_PATH) path = process.env.VERA_TEST_DIALOG_PATH;
        else {
          if (!window || window.isDestroyed()) return null;
          const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
          if (result.canceled) return null;
          path = result.filePaths[0];
        }
        if (!path) return null;
        const chosen = await workbench.chooseAdditionalFolder(path, workbenchId);
        return { id: chosen.id, label: credentials.scrub(chosen.path) };
      },
      "workbench.commandPrefixes.list": async ({ workbenchId }) =>
        (await workbench.listCommandPrefixes(workbenchId)).map(({ id, prefix }) => ({
          id,
          label: credentials.scrub(prefix),
        })),
      "workbench.pinned.get": () => workbench.getPinned(),
      "workbench.pinned.update": ({ content, workbenchId }) => workbench.updatePinned(content, workbenchId),
      "workbench.files": ({ query }) => workbench.files(query),
    },
    log: (failure) => logger.log("error", "ipc.internal", failure),
    sanitize: (value) => credentials.sanitize(value),
    ready: () => credentialsReady,
  }),
);

const windowStateFile = () => join(app.getPath("userData"), "window-state.json");
async function createWindow(state: WindowState): Promise<void> {
  Menu.setApplicationMenu(null);
  const stateFile = windowStateFile();
  window = new BrowserWindow({
    title: "VERA",
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors),
    // nativeTheme.themeSource holds the saved theme here, so the first frame is not white in dark mode.
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
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
  recoverRenderer(created, (reason, reloading) => {
    logger.log("error", "window.renderer.gone", { reason, reloading });
    sessions.clearSubscriptions();
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

if (!firstInstance) {
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
    terminals.suspend();
    catalogChecks.close();
    void drainShutdown(
      // Installs and probes stop with the app; their uv and tar process trees are killed.
      [
        ["provisioner", () => provisioner.drain()],
        ["scopedProvisioners", () => scopedProvisioners.close()],
        ["pluginListings", () => pluginListings.close()],
        ["programs", () => programs.stopAll()],
        ["terminals", () => terminals.closeAll()],
      ],
      [
        ["sessions", () => sessions.close()],
        ["workbench", () => workbench.close()],
        ["fileWorkers", () => fileWorkers.dispose()],
        ["indexer", () => indexer.close()],
        ["fileProbe", () => closeFileProbe?.()],
        ["modelGateway", () => modelGateway.close()],
        ["chatgpt", () => chatgpt.close()],
        ["providers", () => providers.close()],
        ["webAccess", () => webAccess.close()],
        ["partsAccess", () => partsAccess.close()],
        ["credentials", () => credentials.close()],
        ["settings", () => settings.close()],
        ["log", () => logger.flush()],
      ],
      // Logged before the log step flushes; the will-quit flush below covers a failed log step.
      (step) => logger.log("error", "app.shutdown.step.failed", { step }),
    ).then((clean) => {
      drained = true;
      try {
        // A failed drain must never start the installer.
        if (clean && updates?.finishShutdown()) return;
      } catch {
        clean = false;
      }
      if (!clean) console.error("VERA shutdown persistence failed");
      updates?.close();
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
      // Credentials decrypt through safeStorage (the desktop keyring on Linux) while settings and the window
      // state load; the window does not wait for them, IPC does (credentialsReady).
      credentialsReady = credentials.load().then(
        () => {},
        () => logger.log("error", "credentials.load.failed"),
      );
      const [, windowState] = await Promise.all([
        settings.load(),
        loadWindowState(
          windowStateFile(),
          screen.getAllDisplays().map((display) => display.workArea),
        ),
      ]);
      announcedSettings = settings.get().settings;
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
        const { scriptedSubscription, scriptedGateway } = await import("./chatgpt-probe.js");
        if (process.env.VERA_TEST_CHATGPT === "1") {
          await modelGateway.close();
          modelGateway = new ProviderGateway(
            settings,
            credentials,
            providers,
            systemClock,
            scriptedGateway({
              settings: () => settings.get().settings,
              credentials,
              scrub: (text) => credentials.scrub(text),
              knownSecrets: () => credentials.knownSecrets(),
              now: () => systemClock.now().getTime(),
            }),
          );
        }
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
        await partsAccess.close();
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
      await createWindow(windowState);
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
