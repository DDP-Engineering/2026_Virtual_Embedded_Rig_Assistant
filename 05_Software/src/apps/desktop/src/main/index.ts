// First import, so the opt-out is set while the main module loads, before any inference host or worker exists.
import "./inference-telemetry.js";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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
  PluginCatalog,
  PluginStore,
  ProgramRunner,
  Provisioner,
  pluginPlatform,
  ResourceLeases,
  readEmbeddingModel,
  readPluginHelp,
  resolveCommandShell,
  SettingsService,
  settingStates,
  splitModelReference,
  TurnLimit,
  WebDownloads,
  type WorkbenchHost,
  WorkbenchService,
} from "@vera/core";
import type { AdvancedKey } from "@vera/shared";
import {
  type BrowserSessionView,
  type EventEnvelope,
  eventEnvelopeSchema,
  type HelpLanguage,
  type HelpPage,
  type HelpPageSummary,
  helpLanguages,
  resolveAdvanced,
  type Settings,
  settingsChangedEvent,
  veraError,
  veraErrorSchema,
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
  Notification,
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
import { AgentBrowser } from "./browser/agent-browser.js";
import { BrowserError } from "./browser/failure.js";
import { BrowserHost } from "./browser/host.js";
import { BrowserAccessPolicy, type BrowserOwner } from "./browser/policy.js";
import { BrowserRuntime } from "./browser/runtime.js";
import { CatalogChecks } from "./catalog-checks.js";
import { ChatgptAuth } from "./chatgpt-auth.js";
import { CredentialFile } from "./credentials.js";
import { configureDataLocations } from "./data-locations.js";
import { CaptureJobs } from "./dictation/capture-jobs.js";
import { DictationModels } from "./dictation/models.js";
import { transcribeInWorker } from "./dictation/worker-host.js";
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
import { GitDiffService } from "./git/diff-service.js";
import { GitHistoryService } from "./git/history-service.js";
import { GitReader } from "./git/read.js";
import { containingRepository } from "./git/repository.js";
import { readStatus } from "./git/status.js";
import { GitStatusService } from "./git/status-service.js";
import { GitWatch } from "./git/watch.js";
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
import { windowsNotificationAppId } from "./session-notification-copy.js";
import { SessionNotifications } from "./session-notifications.js";
import { createSessionOrder } from "./session-order.js";
import { installSessionPerformance } from "./session-performance.js";
import { holdsSession, SessionRouter } from "./session-router.js";
import { planReviewHandlers, SessionsHost } from "./sessions.js";
import { drainShutdown } from "./shutdown.js";
import { createPtyFactory } from "./terminal-pty.js";
import { TerminalService } from "./terminals.js";
import { desktopUpdateBackend, updateDistribution } from "./update-backend.js";
import { Updates } from "./updates.js";
import { WebAccessService } from "./web-access.js";
import { popupWindowMenu, restoreWindowBounds, titleBarOverlay, windowBackground } from "./window-chrome.js";
import { loadWindowState, saveWindowState, type WindowState } from "./window-state.js";
import { publicWorkbenchFolders } from "./workbench-folders.js";
import { WorkbenchRuntimes } from "./workbench-runtimes.js";
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
// Match the installed NSIS shortcut. An unpackaged dev process must not take over that shortcut.
if (process.platform === "win32" && app.isPackaged)
  app.setAppUserModelId(windowsNotificationAppId(__VERA_TEST__));
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
let quitting = false;

/**
 * The offline component archive (browser runtime or dictation model) the user picks; undefined when the picker
 * closes without a file. Instrumented builds take `VERA_TEST_COMPONENT_FILE`, where an empty value is a closed
 * picker. The renderer never supplies the path.
 */
async function pickComponentArchive(): Promise<string | undefined> {
  if (__VERA_TEST__ && process.env.VERA_TEST_COMPONENT_FILE !== undefined)
    return process.env.VERA_TEST_COMPONENT_FILE || undefined;
  if (!window || window.isDestroyed()) return undefined;
  const result = await dialog.showOpenDialog(window, {
    properties: ["openFile"],
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });
  return result.canceled ? undefined : result.filePaths[0];
}
nativeTheme.on("updated", () => {
  if (!window || window.isDestroyed()) return;
  window.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors));
  window.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors));
});
// IPC waits for this before dispatch: responses are redacted with every stored secret. It never rejects;
// a credential file that fails to load leaves credential operations failing, not the window (PERF-11).
let credentialsReady: Promise<void> = Promise.resolve();
/** An application Advanced value for the app-wide services (worker pool, program runner, web provider). */
function appAdvanced<K extends AdvancedKey>(key: K) {
  return resolveAdvanced(key, { app: settings.get().settings.advanced }).value;
}
// The application's Worker deadline, read as each grep or parse_log task starts (REQ-FUNC-5eacaf9f).
const fileWorkers = createDesktopWorkerPool({ deadlineMs: () => appAdvanced("workerDeadline") * 1000 });
const pluginListings = new PluginListingHost(join(dataLocations.paths.userData, "plugins"));
const downloadTransfer = createDesktopDownloadTransfer();
const browserFixture =
  __VERA_TEST__ && process.env.VERA_TEST_BROWSER_ARCHIVE
    ? (await import("./browser/fixture.js")).createBrowserFixture(process.env.VERA_TEST_BROWSER_ARCHIVE)
    : undefined;
const browserRuntime = new BrowserRuntime(
  join(dataLocations.paths.userData, "browser-runtime"),
  browserFixture ? { transfer: browserFixture.transfer } : {},
);
const browserAccess = new BrowserAccessPolicy((workbenchId) => {
  const snapshot = workbench().getSnapshot();
  return (
    settings.get().settings.interactiveBrowser === true &&
    browserRuntime.status().phase !== "removing" &&
    !snapshot.readOnly &&
    snapshot.config.id === workbenchId &&
    snapshot.config.interactive_browser === true
  );
}, browserFixture?.network);
const browserHost = new BrowserHost(browserRuntime, { policy: browserAccess });
let browserNoticeSince = performance.now();
const models = app.isPackaged
  ? join(process.resourcesPath, "models")
  : join(here, "../../../../../src/models");
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
      [`--models=${models}`],
      { serviceName: "VERA Indexer" },
    ),
  modelId: (model) => embeddingModelId(readEmbeddingModel(models, model)),
  status: (state) => {
    emitAppEvent({ topic: "app", id: "app", event: { type: "indexer.status", state } });
    for (const { workbench } of runtimes.all()) {
      workbench.setDocumentIndexerStopped(state === "stopped");
      if (state === "running") workbench.refreshDocuments();
    }
  },
  // The application's extraction time limit and embedding idle time travel with each message.
  limits: () => ({
    extractionMs: appAdvanced("extractionTimeout") * 1000,
    embeddingIdleMs: appAdvanced("embeddingIdle") * 1000,
  }),
});
if (__VERA_TEST__) Object.assign(globalThis, { veraTestIndexerPid: () => indexer.pid() });
let closeFileProbe: (() => Promise<void>) | undefined;
let rendererUrl = "vera://app/index.html";
let updates: Updates | undefined;
/**
 * Makes an event safe for the renderer. Session events are masked with the agent masking of `owner`, the
 * workbench holding the session, and carry image identities for it; index events use the shown workbench's
 * Display identities.
 */
function projectEvent(envelope: EventEnvelope, owner: () => WorkbenchSnapshot): EventEnvelope {
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
  if (envelope.topic === "workbench" && envelope.event.type === "index.status") {
    const { status } = envelope.event;
    return {
      ...envelope,
      event: {
        type: "index.status",
        status: {
          ...status,
          guard: publicGuard(status.guard, (text) => display.scrub(envelope.id, text)),
        },
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
  if (envelope.topic !== "session") return sanitizeEvent(envelope, (text) => credentials.scrub(text));
  const snapshot = owner();
  return sanitizeEvent(
    envelope,
    sessionContent(snapshot),
    (text) => credentials.scrub(text),
    sessionImageIdentity(snapshot),
  );
}
const eventTarget = () => window?.webContents;
const eventScrub = (text: string) => credentials.scrub(text);
export const emitAppEvent = createEventEmitter(eventTarget, eventScrub, (envelope) =>
  projectEvent(envelope, () => workbench().getSnapshot()),
);
/** The events of one runtime's sessions, masked for that runtime's workbench whatever the foreground. */
function runtimeEvents(owner: WorkbenchService) {
  return createEventEmitter(eventTarget, eventScrub, (envelope) =>
    projectEvent(envelope, () => owner.getSnapshot()),
  );
}
/** The sidebar re-reads session.activity: a session's turn, approval, title or status, or the open runtimes changed. */
function announceActivity(): void {
  emitAppEvent({ topic: "app", id: "app", event: { type: "session.activity" } });
}
/**
 * One count of active turns over every open workbench, bounded by the Concurrent turns setting read at each
 * admission (REQ-FUNC-52e97b95, REQ-FUNC-56f63014); every change is announced to the renderer (REQ-FUNC-33cd5f9f).
 */
const turnLimit = new TurnLimit({
  limit: () => appAdvanced("concurrentTurns"),
  changed: (state) =>
    emitAppEvent({ topic: "app", id: "app", event: { type: "session.capacity", ...state } }),
});
// The logger exists before the settings service: until they load, its Log retention getter throws and nothing is pruned.
const logger = createLogger(dataLocations.paths.logs, systemClock, () => appAdvanced("logDays"));
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
    if ((announcedSettings?.interactiveBrowser === true) !== (next.interactiveBrowser === true))
      browserNoticeSince = performance.now();
    browserAccess.reconcile();
    emitAppEvent({ topic: "app", id: "app", event: settingsChangedEvent(announcedSettings, next) });
    announcedSettings = next;
    turnLimit.refresh();
    updates?.settingsChanged();
    // Settings change only after load, inside app.whenReady, when the catalog checks exist.
    catalogChecks.settingsChanged();
  },
});
const dictation = new DictationModels(dataLocations.paths.userData, settings);
const capture = new CaptureJobs(
  () => dictation.resolveSelected(),
  (model, pcm, signal) =>
    transcribeInWorker(model, pcm, signal, appAdvanced("dictationTranscriptionTimeout") * 1000),
  (id) => emitAppEvent({ topic: "app", id: "app", event: { type: "dictation.interrupted", id } }),
);
const focusedRenderer = () =>
  window && !window.isDestroyed() && window.isFocused()
    ? { webContents: window.webContents, url: rendererUrl }
    : undefined;
const sessionOrder = createSessionOrder(settings);
/** Shared by every workbench runtime; each WorkbenchService owns one workbench's lock, database and indexing. */
const workbenchHost: Omit<WorkbenchHost, "changed"> = {
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
};
function workbenchChanged(source: WorkbenchService, event: Parameters<WorkbenchHost["changed"]>[0]): void {
  const type = event.event.type;
  if (source === workbench()) {
    if (type === "closed") display.closed(event.id);
    if (type === "config.changed") {
      gitStatus.reconcile();
      gitDiff.reconcile();
      gitHistory.reconcile();
      browserNoticeSince = performance.now();
      browserAccess.reconcile();
    }
  } else if (
    type === "closed" ||
    type === "index.document" ||
    type === "index.status" ||
    type === "index.guard"
  ) {
    // The renderer treats these as events of the shown workbench. Background retirement reports via session.activity.
    return;
  }
  emitAppEvent(eventEnvelopeSchema.parse(event));
}
/** The workbench service of the foreground runtime: the workbench the window shows. */
function workbench(): WorkbenchService {
  return runtimes.foreground.workbench;
}
/** The session host of the foreground runtime. */
function sessions(): SessionsHost {
  return runtimes.foreground.sessions;
}
const maskingFor = createMaskingResolver(() => settings.get().settings);
/** Message image identities of a session held by `owner`; they resolve while that workbench is shown. */
function sessionImageIdentity(owner: WorkbenchSnapshot): (path: string) => string {
  return (path) => display.sessionImagePath(owner, path);
}
/** Session text as the renderer receives it: masked per the agent masking of the workbench holding it. */
function sessionContent(owner: WorkbenchSnapshot): (text: string) => string {
  return (text) => (maskingFor(owner.config, "agent") ? credentials.scrub(text) : text);
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
const gitReader = new GitReader(dataLocations.paths.userData);
const gitScope = () => {
  try {
    const { config, indexLease, folder } = workbench().getSnapshot();
    return { workbenchId: config.id, indexLease, folder, enabled: config.interface.git_status };
  } catch {
    return undefined;
  }
};
const gitDiff = new GitDiffService({
  scope: gitScope,
  resolve: (id, path) => display.resolve(id, path),
  read: async (folder, path, comparison, signal) => {
    const repository = await containingRepository(folder, signal);
    return repository?.scope === folder
      ? gitReader.diff(repository, path, comparison, signal)
      : { state: "unavailable", base: comparison === "staged" ? "unknown" : "index" };
  },
  project: (id, path, result) => display.gitDiff(id, path, result),
});
const gitHistory = new GitHistoryService({
  scope: gitScope,
  resolve: (id, path) => display.resolve(id, path),
  eligible: async (folder, path, signal) => {
    const repository = await containingRepository(folder, signal);
    return repository?.scope === folder
      ? gitReader.historyEligibility(repository, path, signal)
      : "unavailable";
  },
  read: async (folder, path, signal) => {
    const repository = await containingRepository(folder, signal);
    return repository?.scope === folder
      ? gitReader.history(repository, path, signal)
      : { state: "unavailable" };
  },
  project: (id, path, result) => display.gitHistory(id, path, result),
});
const gitStatus = new GitStatusService({
  scope: gitScope,
  read: (folder, signal) => readStatus(gitReader, folder, signal),
  project: (id, status) => display.gitStatus(id, status),
  watch: (folder, changed, fault) => new GitWatch(folder, changed, fault),
  publish: (update) =>
    emitAppEvent({
      topic: "workbench",
      id: update.workbenchId,
      event: { type: "git.status", update },
    }),
});
/** Installed plugins live under userData; enablement is per workbench (workbench.yaml). */
const plugins = new PluginStore({ root: join(dataLocations.paths.userData, "plugins") });
const processHost = createDesktopProcessHost();
const terminals = new TerminalService({
  current: () => {
    const snapshot = workbench().getSnapshot();
    return { id: snapshot.config.id, folder: snapshot.folder };
  },
  shell: createCommandShellHost(
    processHost,
    () => settings.get().settings.shell,
    (text) => credentials.scrub(text),
  ),
  shellForBlock: async (kind) => {
    const installed = await detectCommandShells(processHost);
    const executable = installed.find(
      (shell) =>
        shell.executable &&
        (kind === "powershell" ? shell.id === "pwsh" || shell.id === "powershell" : shell.id === "bash"),
    )?.executable;
    if (!executable)
      throw {
        ...veraError("NOT_FOUND"),
        messageKey: "chatActions.shellUnavailable",
        params: { shell: kind },
      };
    return resolveCommandShell(processHost, executable);
  },
  pty: createPtyFactory(
    processHost,
    app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked/node_modules/node-pty") : "node-pty",
  ),
  scrub: (text) => credentials.scrub(text),
  secrets: () => credentials.knownSecrets(),
  maskUserOutput: () => maskingFor(workbench().getSnapshot().config, "runs"),
  maskAgentOutput: () => maskingFor(workbench().getSnapshot().config, "agent"),
  // Read as a terminal opens (count, buffer) and as the agent reads one (output size).
  limits: () => ({
    terminals: appAdvanced("terminals"),
    bufferChars: appAdvanced("terminalBufferK") * 1024,
    agentChars: appAdvanced("terminalAgentChars"),
  }),
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
  // The application's run limits, read at each start, hold and prune (REQ-FUNC-dd50ebed).
  limits: () => ({
    maxBackground: appAdvanced("backgroundPrograms"),
    logsKept: appAdvanced("runLogsKept"),
    logBytes: appAdvanced("runLogMB") * 1024 * 1024,
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
/** Catalog checks at start and every Plugin catalog check interval read the index only, while updates are not Off. */
const catalogChecks = new CatalogChecks({
  enabled: () => settings.get().settings.updates.mode !== "off" && Boolean(catalogLocation()),
  intervalMs: () => appAdvanced("catalogInterval") * 60 * 60 * 1000,
  check: async () => {
    await catalog.view({ refresh: true });
    emitAppEvent({ topic: "app", id: "app", event: { type: "plugins.catalog" } });
  },
});
/** The workbench a snapshot names: its ID and folder, since clones of one folder share the ID. */
const workbenchKey = (snapshot: WorkbenchSnapshot) => `${snapshot.config.id}\n${snapshot.folder}`;
/** The workbench the window shows; undefined while none is open. */
function foregroundKey(): string | undefined {
  try {
    return workbenchKey(workbench().getSnapshot());
  } catch {
    return undefined;
  }
}
/**
 * Opens or creates a workbench. User terminals belong to the shown workbench: they close only when another
 * workbench takes its place, so a failed open or a reopen in place keeps them.
 */
async function replaceForeground(operation: () => Promise<WorkbenchSnapshot>): Promise<WorkbenchSnapshot> {
  const before = foregroundKey();
  const snapshot = await operation();
  if (workbenchKey(snapshot) !== before) {
    display.close();
    browserNoticeSince = performance.now();
    await Promise.all([terminals.closeAll(), browserHost.closeAll()]);
  }
  return snapshot;
}
/** Suspend new resource ownership while replacing the current workbench. */
async function workbenchTransition<T>(operation: () => Promise<T>): Promise<T> {
  browserHost.suspend();
  terminals.suspend();
  try {
    return await operation();
  } finally {
    terminals.resume();
    browserHost.resume();
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
const sessionNotifications = new SessionNotifications({
  platform: process.platform,
  preferences: () => settings.get().settings.notifications,
  language: interfaceLanguage,
  window: () =>
    !quitting && window && !window.isDestroyed()
      ? { visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused() }
      : undefined,
  supported: () => Notification.isSupported(),
  create: (options) => new Notification(options),
  activate: (token) => {
    if (!window || window.isDestroyed() || quitting) return;
    if (window.isMinimized()) window.restore();
    if (!window.isVisible()) window.show();
    window.focus();
    emitAppEvent({ topic: "app", id: "app", event: { type: "session.notification.clicked", token } });
  },
  failed: () => logger.log("warn", "session.notification.failed"),
});
/** What every workbench runtime's session host shares; each runtime adds its own WorkbenchService. */
const sessionOptions: Omit<
  ConstructorParameters<typeof SessionsHost>[0],
  "workbench" | "settled" | "emit" | "activity"
> = {
  log: (message) => logger.log("error", "agent.turn.failed", { message }),
  admission: turnLimit,
  liveActivity: (owner, id, event) => sessionNotifications.observe(owner, id, event),
  terminals: (workbenchId) => terminals.reader(workbenchId),
  help: { app: help, language: interfaceLanguage },
  pluginBuilder: plugins,
  managedRoots: [dataLocations.paths.userData],
  web: webAccess.provider,
  browser: (owner, sessionId) =>
    new AgentBrowser(
      { workbenchId: owner.config.id, sessionId },
      browserHost,
      browserAccess,
      (tool) => {
        try {
          const shown = workbench().getSnapshot();
          return workbenchKey(shown) !== workbenchKey(owner) || shown.config.tools.disabled.includes(tool);
        } catch {
          return true;
        }
      },
      () => {
        const timeout = resolveAdvanced("browserNavigationTimeout", {
          app: settings.get().settings.advanced,
        });
        return timeout.source === "default" ? undefined : timeout.value * 1000;
      },
    ),
  parts: partsAccess.provider,
  downloads: (root) =>
    new WebDownloads(root, {
      access: webAccess.provider,
      transfer: downloadTransfer,
      pdf: createDownloadPdfExtractor(new URL("./pdf-worker.js", import.meta.url)),
    }),
  settings,
  gateway: () => modelGateway,
  credentials,
  clock: systemClock,
  workers: fileWorkers,
  embeddings: (model) => indexer.embeddings(model),
  version: app.getVersion(),
  target: () =>
    window && !window.isDestroyed() ? { webContents: window.webContents, url: rendererUrl } : undefined,
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
};
/**
 * The open workbench runtimes: the foreground one the window shows and the previous ones that still
 * finish their turns in the background. Releasing a runtime stops its program runs (REQ-FUNC-39d5e6d9).
 */
const runtimes = new WorkbenchRuntimes({
  create: (settled) => {
    const service: WorkbenchService = new WorkbenchService(
      { ...workbenchHost, changed: (event) => workbenchChanged(service, event) },
      indexer.processor,
    );
    service.setDocumentIndexerStopped(indexer.state() === "stopped");
    return {
      workbench: service,
      sessions: new SessionsHost({
        ...sessionOptions,
        workbench: service,
        settled,
        emit: runtimeEvents(service),
        activity: announceActivity,
      }),
    };
  },
  stopPrograms: (folder) => programs.stopWorkbench(folder),
  log: (event) => logger.log("error", event),
  changed: () => {
    gitStatus.reconcile();
    gitDiff.reconcile();
    gitHistory.reconcile();
    announceActivity();
  },
});
/** Session requests reach the runtime holding their session or named workbench, whichever is shown. */
const router = new SessionRouter(() => runtimes.all());
ipcMain.handle("vera:subscription", async (event, action, payload) => {
  await credentialsReady;
  return router.subscription(event, action, payload);
});
let initialBrowserInspection: ReturnType<BrowserRuntime["inspect"]> | undefined;

async function browserSettings() {
  if (browserRuntime.status().phase === "unknown") {
    initialBrowserInspection ??= browserRuntime.inspect();
    await initialBrowserInspection;
  }
  let current: WorkbenchSnapshot | undefined;
  try {
    current = workbench().getSnapshot();
  } catch (error) {
    if (veraErrorSchema.safeParse(error).data?.code !== "NOT_FOUND") throw error;
  }
  return {
    runtime: browserRuntime.view(),
    appEnabled: settings.get().settings.interactiveBrowser === true,
    workbench: current
      ? {
          id: current.config.id,
          enabled: current.config.interactive_browser === true,
          readOnly: current.readOnly,
        }
      : null,
  };
}

/** Resolve a BrowserOwner against the serialized active workbench and session store. */
function ownedBrowser<T>(
  owner: BrowserOwner,
  act: (browser: AgentBrowser | undefined, canGrant: boolean) => T | Promise<T>,
): Promise<T> {
  return router.inSession(
    owner.sessionId,
    (service, snapshot) => {
      if (workbenchKey(snapshot) !== foregroundKey()) throw veraError("CONFLICT");
      const { archived, browser } = service.browserSession(owner.sessionId);
      const canGrant = !archived && browserAccess.isEnabled(owner.workbenchId);
      return act(browser instanceof AgentBrowser ? browser : undefined, canGrant);
    },
    {},
    owner.workbenchId,
  );
}

function browserIpcError(error: unknown): never {
  if (!(error instanceof BrowserError)) throw error;
  throw {
    code: "DENIED",
    messageKey: `browser.failure.${error.code}`,
  };
}

const emptyBrowserView = { busy: false, open: false, currentUrl: null, failure: null };

/** The folder of the open workbench when `workbenchId` names it; CONFLICT otherwise. */
function openWorkbenchFolder(workbenchId: string): string {
  const snapshot = workbench().getSnapshot();
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
    return plugins.forWorkbench(workbench().getSnapshot().folder);
  } catch {
    return plugins;
  }
}
const runPresentation = new RunPresentation({
  current: () => workbench().getSnapshot(),
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
  invalidatePrograms();
}
/** Every open workbench, background ones included, recomputes its program prompt entries on its next session call. */
function invalidatePrograms(): void {
  for (const runtime of runtimes.all()) runtime.sessions.invalidatePrograms();
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
    workbench().readDocuments(workbenchId, async (root, db) => {
      const embeddings = indexer.embeddings(workbench().getSnapshot().config.embeddings.model);
      if (db.prepare("SELECT 1 FROM embeddings WHERE model_id=? LIMIT 1").get(embeddings.modelId))
        return { root, embeddings };
    }),
  embed: ({ root, embeddings }, signal) => embeddings.embed(root, ["warm-up"], signal),
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
      "app.clipboard.write": ({ text }) => {
        clipboard.writeText(text);
        return {};
      },
      "terminal.create": ({ workbenchId, cols, rows, shell }) =>
        terminals.create(workbenchId, cols, rows, shell),
      "terminal.execute": async ({ workbenchId, id, shell, text }) => {
        await terminals.execute(workbenchId, id, shell, text);
        return {};
      },
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
      "browser.settings.get": browserSettings,
      "browser.runtime.install": async () => {
        await browserRuntime.provision();
        return browserRuntime.view();
      },
      "browser.runtime.installFile": async () => {
        if (
          ["verifying", "downloading", "installing", "removing", "ready"].includes(
            browserRuntime.status().phase,
          )
        )
          return browserRuntime.view();
        const file = await pickComponentArchive();
        if (file) await browserRuntime.provision({ file });
        return browserRuntime.view();
      },
      "browser.runtime.cancel": async () => {
        try {
          await browserRuntime.cancel();
        } catch (error) {
          browserIpcError(error);
        }
        return browserRuntime.view();
      },
      "browser.runtime.remove": async () => {
        await browserRuntime.remove(() => {
          browserNoticeSince = performance.now();
          return browserHost.closeAll();
        });
        return browserRuntime.view();
      },
      "browser.session.get": (owner): Promise<BrowserSessionView> =>
        ownedBrowser(owner, (browser, canGrant) => {
          const enabled = browserAccess.isEnabled(owner.workbenchId);
          const view = (canGrant && browser?.view(browserNoticeSince)) || emptyBrowserView;
          return {
            ...view,
            enabled,
            canGrant,
            origins: canGrant
              ? browserAccess.origins(owner).filter((origin) => !credentials.containsSecret(origin))
              : [],
            currentUrl:
              view.currentUrl && !credentials.containsSecret(view.currentUrl) ? view.currentUrl : null,
          };
        }),
      "browser.session.grant": ({ origin, ...owner }) =>
        ownedBrowser(owner, (browser, canGrant) => {
          if (!canGrant) throw veraError("DENIED");
          if (credentials.containsSecret(origin)) throw veraError("INVALID");
          try {
            browserAccess.grant(owner, origin);
          } catch (error) {
            browserIpcError(error);
          }
          browser?.clearPresentation();
          return {};
        }),
      "browser.session.show": async (owner) => {
        const browser = await ownedBrowser(owner, (browser, canGrant) => {
          if (!canGrant) throw veraError("DENIED");
          return browser;
        });
        try {
          if (!browser) throw new BrowserError("page-closed");
          await browser.show();
        } catch (error) {
          browserIpcError(error);
        }
        return {};
      },
      "browser.session.close": async (owner) => {
        const { completion } = await ownedBrowser(owner, (browser) => {
          browser?.clearPresentation();
          return { completion: browserHost.closeSession(owner) };
        });
        await completion;
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
      "skills.list": ({ workbenchId }) => workbench().listSkills(workbenchId),
      "skills.open": ({ workbenchId, source, name }) => workbench().openSkill(workbenchId, source, name),
      "skills.create": ({ workbenchId, source, name }) => workbench().saveSkill(workbenchId, source, name),
      "skills.save": ({ workbenchId, source, name, content, sha256 }) =>
        workbench().saveSkill(workbenchId, source, name, content, sha256),
      "skills.toggle": ({ workbenchId, name, enabled }) =>
        workbench().toggleSkill(workbenchId, name, enabled),
      "plugins.list": async ({ workbenchId }) => {
        const snapshot = workbenchId ? workbench().getSnapshot() : undefined;
        if (workbenchId && snapshot?.config.id !== workbenchId) throw veraError("CONFLICT");
        const database = snapshot ? workbench().getDatabase() : undefined;
        const list = await pluginListings.list(snapshot?.folder);
        if (
          snapshot &&
          (workbench().getSnapshot().config.id !== snapshot.config.id ||
            workbench().getSnapshot().folder !== snapshot.folder ||
            workbench().getDatabase() !== database)
        )
          throw veraError("CONFLICT");
        const enabled = workbenchId ? workbench().enabledPlugins(workbenchId) : [];
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
        const result = await workbench().togglePlugin(workbenchId, id, enabled);
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
        invalidatePrograms();
        return statuses;
      },
      "plugins.installArchive": async ({ id, program, sha256, workbenchId }) => {
        const before = workbenchId ? workbench().getSnapshot() : undefined;
        const beforeDb = workbenchId ? workbench().getDatabase() : undefined;
        const store = workbenchId ? activePluginStore(workbenchId) : plugins;
        const validate = async () => {
          if (
            before &&
            (workbench().getSnapshot().config.id !== before.config.id ||
              workbench().getSnapshot().folder !== before.folder ||
              workbench().getDatabase() !== beforeDb)
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
        const snapshot = workbenchId ? workbench().getSnapshot() : undefined;
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
      "docs.imageThumbnail": ({ workbenchId, path }) => display.imageThumbnail(workbenchId, path),
      // The Docs tree's OS actions go through the tree's confinement first (TASK-eae3a69e).
      "docs.openers": () => ({ apps: [...openers().keys()] }),
      "docs.openWith": ({ workbenchId, path, app }) =>
        openWith(
          () => workbench().locateEntry(workbenchId, display.resolve(workbenchId, path)),
          app,
          openers(),
          launchDetached,
        ),
      "docs.systemApps": async ({ workbenchId, path }) => ({
        apps: (
          await systemApps(
            () => workbench().locateEntry(workbenchId, display.resolve(workbenchId, path)),
            systemAppDeps(),
          )
        ).map(({ id, name }) => ({ id, name })),
      }),
      "docs.openSystemApp": ({ workbenchId, path, app }) =>
        openSystemApp(
          () => workbench().locateEntry(workbenchId, display.resolve(workbenchId, path)),
          app,
          systemAppDeps(),
          launchDetached,
        ),
      "docs.reveal": ({ workbenchId, path }) =>
        revealEntry(
          () => workbench().locateEntry(workbenchId, display.resolve(workbenchId, path)),
          (absolute) => shell.showItemInFolder(absolute),
        ),
      "docs.copyPath": ({ workbenchId, path, form }) =>
        copyEntry(
          () => workbench().locateEntry(workbenchId, display.resolve(workbenchId, path)),
          display.resolve(workbenchId, path),
          form,
          (text) => clipboard.writeText(text),
          sep,
        ),
      "git.diff": (request) => gitDiff.request(request),
      "git.historyEligibility": (request) => gitHistory.eligibility(request),
      "git.history": (request) => gitHistory.history(request),
      "git.status": (request) => {
        gitStatus.request(request);
        return {};
      },
      "docs.status": async ({ workbenchId, indexLease }) => {
        const status = workbench().documentIndexStatus(workbenchId, indexLease);
        return { ...status, guard: publicGuard(status.guard, (text) => display.scrub(workbenchId, text)) };
      },
      "docs.volume": async ({ workbenchId }) => ({
        workbenchId,
        volume: workbench().documentVolume(workbenchId),
        guard: display.guard(workbenchId),
      }),
      "docs.approve": async ({ workbenchId, files }) => {
        await workbench().approveDocuments(workbenchId, files);
        return {};
      },
      "docs.search": ({ workbenchId, query }) => display.search(workbenchId, query),
      "docs.open": (request) =>
        display.open(
          request.workbenchId,
          () =>
            "sessionId" in request
              ? sessions().run((service) =>
                  workbench().readDocuments(request.workbenchId, () =>
                    service.openCitation(request.sessionId, request.messageId, request.ref),
                  ),
                )
              : workbench().openDocument(
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
        await workbench().reindexDocuments(workbenchId);
        return {};
      },
      "downloads.list": ({ workbenchId }) =>
        sessions().run((service) =>
          workbench().readDocuments(workbenchId, async () => ({
            workbenchId,
            downloads: (await service.listDownloads())
              .map((record) => publicWebDownload(record, (text) => credentials.scrub(text)))
              .filter((record) => record !== undefined),
          })),
        ),
      "downloads.open": ({ workbenchId, downloadId }) =>
        sessions().run((service) =>
          workbench().readDocuments(workbenchId, async () => ({
            workbenchId,
            downloadId,
            content: publicViewer(await service.openDownload(downloadId), (text) => credentials.scrub(text)),
          })),
        ),
      "downloads.reveal": ({ downloadId }) =>
        sessions().run(async (service) => {
          shell.showItemInFolder(await service.locateDownload(downloadId));
          return {};
        }),
      "app.openExternal": (request) => openExternal(request, (url) => shell.openExternal(url)),
      "providers.chatgpt.login": (request) => chatgpt.login(request),
      "providers.chatgpt.cancel": () => chatgpt.cancel(),
      "providers.chatgpt.status": () => chatgpt.status(),
      "providers.chatgpt.logout": () => chatgpt.logout(),
      "artifacts.list": ({ sessionId }) =>
        router.inSession(sessionId, (s, owner) =>
          s
            .listArtifacts(sessionId)
            .map((a) =>
              publicArtifact(a, (text) =>
                maskingFor(owner.config, "exports") ? credentials.scrub(text) : text,
              ),
            ),
        ),
      "artifacts.open": ({ artifactId }) =>
        sessions().run(async (s) =>
          publicArtifact(await s.openArtifact(artifactId), (text) =>
            maskingFor(workbench().getSnapshot().config, "exports") ? credentials.scrub(text) : text,
          ),
        ),
      "artifacts.reveal": ({ artifactId }) =>
        sessions().run((s) => revealArtifact(s, artifactId, (path) => shell.showItemInFolder(path))),
      "artifacts.export": async ({ artifactId }) => {
        const owner = workbench().getSnapshot().config.id;
        const name = await sessions().run((s) =>
          exportName(s, artifactId, (text) => credentials.scrub(text)),
        );
        const path = await chooseSavePath({ defaultPath: name });
        if (path === null) return { exported: false };
        return sessions().run((s) => {
          if (workbench().getSnapshot().config.id !== owner) throw veraError("CONFLICT");
          return exportArtifact(s, artifactId, {
            masking: () => maskingFor(workbench().getSnapshot().config, "exports"),
            root: workbench().getSnapshot().folder,
            choose: async () => path,
            write: (target, content) => createFileAccess(systemClock).writeAtomic(target, content),
            scrub: (text) => credentials.scrub(text),
          });
        });
      },
      "changes.list": ({ sessionId }) =>
        router.inSession(sessionId, (s) =>
          s.listChanges(sessionId).map((c) => ({ ...c, path: credentials.scrub(c.path) })),
        ),
      "changes.get": ({ changeId }) =>
        sessions().run((s) => {
          const c = s.getChange(changeId);
          return { ...c, path: credentials.scrub(c.path), diff: credentials.scrub(c.diff) };
        }),
      "app.revealPath": ({ path }) =>
        sessions().run(() =>
          revealPath(
            workbench().getSnapshot().folder,
            display.resolve(workbench().getSnapshot().config.id, path),
            (absolute) => shell.showItemInFolder(absolute),
          ),
        ),
      "app.openPath": ({ path }) =>
        sessions().run(() =>
          openPath(
            workbench().getSnapshot().folder,
            display.resolve(workbench().getSnapshot().config.id, path),
            (absolute) => shell.openPath(absolute),
          ),
        ),
      // Session requests run in the workbench holding the session, or the named one (REQ-FUNC-038c9b9b).
      "session.list": async ({ workbenchId }) => {
        const route = router.workbench(workbenchId);
        const rows = await route.runtime.sessions.list(workbenchId, () => {
          router.verify(route);
        });
        const owner = router.verify(route);
        return sessionOrder.list(
          owner.config.id,
          rows.map((item) => sanitizeSessionSummary(item, sessionContent(owner))),
        );
      },
      "session.move": ({ workbenchId, sessionId, offset }) =>
        router.inWorkbench(workbenchId, async (s) => {
          await sessionOrder.move(workbenchId, s.list(), sessionId, offset);
          return {};
        }),
      "session.sizes": ({ workbenchId }) => router.inWorkbench(workbenchId, (s) => s.sizes()),
      "session.search": ({ query, workbenchId }) =>
        router.inWorkbench(workbenchId, (s, owner) =>
          s.search(query).map((item) => sanitizeSessionSummary(item, sessionContent(owner))),
        ),
      "session.capacity": () => turnLimit.state(),
      "session.notification.open": ({ token }) => {
        const target = sessionNotifications.takeActivation(token);
        if (!target || quitting) return null;
        return workbenchTransition(async () => {
          try {
            const snapshot = await replaceForeground(() =>
              runtimes.open(target.folder, (owner, db) => {
                if (
                  owner.folder !== target.folder ||
                  owner.config.id !== target.workbenchId ||
                  target.approvalPending?.() === false ||
                  !db ||
                  !holdsSession(db, target.sessionId)
                )
                  throw veraError("NOT_FOUND");
              }),
            );
            return {
              workbench: publicWorkbenchFolders(warmPrograms(snapshot), (text) => credentials.scrub(text)),
              sessionId: target.sessionId,
            };
          } catch (error) {
            const code = veraErrorSchema.safeParse(error).data?.code;
            if (code === "NOT_FOUND" || code === "CONFLICT" || code === "INVALID") return null;
            throw error;
          }
        });
      },
      "session.activity": async () =>
        (await router.activity()).map(({ snapshot, foreground, sessions }) => ({
          workbenchId: snapshot.config.id,
          name: snapshot.config.name,
          folder: snapshot.folder,
          foreground,
          sessions: sessions.map((item) => {
            const { id, title, status } = sanitizeSessionSummary(item, sessionContent(snapshot));
            return { id, title, status: status as "running" | "awaiting_approval" };
          }),
        })),
      "session.export": async ({ sessionId, format }) => {
        // An unknown session is refused before the dialog opens.
        const route = router.session(sessionId);
        await router.run(route, (s) => {
          s.get(sessionId);
        });
        const path = await chooseSavePath({
          defaultPath: `${sessionId}.${format}`,
          filters: [{ name: format === "md" ? "Markdown" : "JSON", extensions: [format] }],
        });
        if (path === null) return { exported: false };
        return router.run(route, (s, owner) =>
          exportSession(s, sessionId, format, {
            masking: () => maskingFor(route.runtime.workbench.getSnapshot().config, "exports"),
            root: owner.folder,
            choose: async () => path,
            write: (target, content) => createFileAccess(systemClock).writeAtomic(target, content),
            scrub: (text) => credentials.scrub(text),
          }),
        );
      },
      "session.create": ({ modelRef, mode, workbenchId, reuseEmpty, acknowledged }) =>
        router.inWorkbench(workbenchId, (s, owner) => {
          if (credentials.containsSecret(modelRef)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          if (mode === "bypass" && acknowledged !== true) throw veraError("DENIED");
          return sanitizeSessionSummary(s.create(modelRef, mode, reuseEmpty), sessionContent(owner));
        }),
      "session.revision": ({ sessionId }) =>
        router.inSession(sessionId, (service) => service.revision(sessionId)),
      "session.get": ({ sessionId }) =>
        router.inSession(sessionId, (s, owner) => {
          const value = s.get(sessionId);
          return {
            ...value,
            snapshot: rendererSessionSnapshot(
              value.snapshot,
              sessionContent(owner),
              sessionImageIdentity(owner),
              (text) => credentials.scrub(text),
            ),
          };
        }),
      "session.item.detail": ({ sessionId, itemId, field }) =>
        router.inSession(sessionId, (s, owner) => ({
          text: sessionContent(owner)(s.itemDetail(sessionId, itemId, field)),
        })),
      // Plan feedback and review reach the runtime holding the session in the named workbench.
      ...planReviewHandlers(
        (workbenchId, sessionId) => router.session(sessionId, workbenchId).runtime.sessions,
        (value) => credentials.containsSecret(value),
      ),
      "session.bookmark": ({ sessionId, messageId, bookmarked }) =>
        router.inSession(
          sessionId,
          (s) => {
            s.bookmark(sessionId, messageId, bookmarked);
            return {};
          },
          { purpose: "metadata" },
        ),
      "session.bookmarks.remove": (request) =>
        router.inSession(
          request.sessionId,
          (s) => {
            s.removeBookmarks(
              request.sessionId,
              "all" in request ? { all: true } : { messageIds: request.messageIds },
            );
            return {};
          },
          { purpose: "metadata" },
        ),
      "session.advanced.set": ({ sessionId, key, value }) =>
        router.inSession(
          sessionId,
          (s) => {
            s.setAdvanced(sessionId, key as AdvancedKey, value);
            return {};
          },
          { purpose: "metadata" },
        ),
      "session.compact": async ({ sessionId }) => {
        // Only the admission runs on the host queue: a summary may take minutes and must not hold other calls.
        const { completion } = await router.inSession(
          sessionId,
          (s) => ({ completion: s.compactNow(sessionId) }),
          { purpose: "metadata" },
        );
        return { status: await completion };
      },
      "session.rename": ({ sessionId, title }) =>
        router.inSession(sessionId, (s, owner) => {
          if (credentials.containsSecret(title)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          return sanitizeSessionSummary(s.rename(sessionId, title), sessionContent(owner));
        }),
      "session.archive.set": ({ sessionId, archived }) =>
        router.inSession(sessionId, async (s, snapshot) => {
          const summary = s.setArchived(sessionId, archived);
          if (archived && workbenchKey(snapshot) === foregroundKey()) {
            const owner = { workbenchId: snapshot.config.id, sessionId };
            const { browser } = s.browserSession(sessionId);
            if (browser instanceof AgentBrowser) browser.clearPresentation();
            await browserHost.closeSession(owner);
          }
          return sanitizeSessionSummary(summary, sessionContent(snapshot));
        }),
      "session.delete": ({ sessionId }) =>
        router.inSession(sessionId, async (s, owner) => {
          await s.delete(sessionId);
          if (workbenchKey(owner) === foregroundKey())
            await browserHost.closeSession({ workbenchId: owner.config.id, sessionId });
          return {};
        }),
      "session.image.attach": ({ workbenchId, sessionId, source }) =>
        router.inSession(
          sessionId,
          (service) => {
            if (credentials.containsSecret("path" in source ? source.path : source.name))
              throw veraError("INVALID");
            if ("path" in source && /__vera_display_[A-Za-z0-9_-]+\.(?:\/|$)/.test(source.path))
              throw veraError("DENIED");
            return service.attachImage(sessionId, source);
          },
          { purpose: "metadata" },
          workbenchId,
        ),
      "session.image.capability": async ({ workbenchId, sessionId }) => {
        const route = router.session(sessionId, workbenchId);
        return route.runtime.sessions.imageCapability(workbenchId, sessionId, () => {
          router.verify(route);
        });
      },
      "session.send": ({ sessionId, text, images }) =>
        router.inSession(
          sessionId,
          async (s, owner) => {
            if (credentials.containsSecret(text)) throw { code: "INVALID", messageKey: "errors.INVALID" };
            // Image identities resolve only while the session's workbench is shown (Display identities).
            const sent = images?.length
              ? await s.sendWithImages(
                  sessionId,
                  text,
                  images.map((path) => display.resolveSessionImagePath(owner.config.id, path)),
                )
              : s.send(sessionId, text);
            embeddingWarmup.request(owner.config.id);
            return sent;
          },
          { purpose: "ordinary", ordinarySessionId: sessionId },
        ),
      // Stop and approval decisions must not wait for plugin loading and program probing.
      "session.stop": ({ sessionId }) =>
        router.inSession(sessionId, (s) => ({ stopped: s.stop(sessionId) }), { purpose: "metadata" }),
      "session.approval.decide": (request) =>
        router.inSession(
          request.sessionId,
          async (s) => {
            if (request.commandPrefix !== undefined) await s.allowCommandApproval(request);
            else s.decideApproval(request);
            return {};
          },
          { purpose: "metadata" },
        ),
      "session.reasoning.get": ({ sessionId }) =>
        router.inSession(sessionId, async (s) => {
          const value = await s.reasoningOptions(sessionId);
          return {
            modelRef: credentials.scrub(value.modelRef),
            options: value.options.map((v) => credentials.scrub(v)),
            selected: value.selected === null ? null : credentials.scrub(value.selected),
          };
        }),
      "session.reasoning.set": ({ sessionId, modelRef, reasoning }) =>
        router.inSession(sessionId, async (s) => {
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
        router.inSession(sessionId, (s, owner) => {
          if (credentials.containsSecret(modelRef)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          return sanitizeSessionSummary(s.setModel(sessionId, modelRef), sessionContent(owner));
        }),
      "session.mode.set": ({ sessionId, mode, acknowledged }) =>
        router.inSession(sessionId, (s, owner) =>
          sanitizeSessionSummary(s.setMode(sessionId, mode, acknowledged), sessionContent(owner)),
        ),
      "session.delegation.bypass.set": ({ workbenchId, sessionId, authorized, acknowledged }) =>
        router.inSession(
          sessionId,
          (s) => s.setDelegatedBypassLaunch(sessionId, authorized, acknowledged),
          {},
          workbenchId,
        ),
      "providers.discover": (request) => modelGateway.discover(request),
      "providers.presets.discover": (request) => modelGateway.discoverPreset(request),
      "providers.image.capability": ({ modelRef }) => modelGateway.imageCapability(modelRef),
      "providers.models": ({ id }) => modelGateway.models(id),
      "providers.test": ({ id, model, testId }) =>
        modelGateway.test(
          id,
          model,
          testId
            ? ({ step, status }) =>
                emitAppEvent({
                  topic: "app",
                  id: "app",
                  event: { type: "provider.test.step", testId, step, status },
                })
            : undefined,
        ),
      "providers.list": () => providers.list(),
      "providers.save": async (request) => {
        const result = await providers.save(request);
        // A replaced key leaves the settings as they were; shown documents still have to mask it.
        if (request.apiKey && result.status === "saved")
          emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } });
        return result;
      },
      "providers.remove": (request) => providers.remove(request),
      "providers.models.enable": (request) => providers.enableModels(request),
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
      "dictation.get": () => dictation.get(),
      "dictation.change": (change) => {
        if (change.action === "remove" && capture.busy) throw veraError("BUSY");
        return dictation.change(change);
      },
      "dictation.installFile": async ({ id }) => {
        const current = await dictation.get();
        if (current.models.some((model) => model.status === "downloading")) return current;
        const file = await pickComponentArchive();
        return file ? dictation.installArchive(id, file) : dictation.get();
      },
      "dictation.begin": ({ id }) =>
        focusedRenderer() ? capture.begin(id) : { status: "permission-denied" },
      "dictation.recording": ({ id }) => capture.recording(id),
      "dictation.finish": ({ id, pcm }) => capture.finish(id, pcm),
      "dictation.cancel": ({ id }) => {
        capture.cancel(id);
        return {};
      },
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
      "workbench.inspect": ({ folder }) => workbench().inspect(folder),
      "workbench.scanDocs": ({ folder, gitignore }) => workbench().scanDocuments(folder, gitignore),
      "workbench.previewDocs": async ({ folder, ...docs }) => {
        const preview = await workbench().previewDocuments(folder, docs);
        return { ...preview, guard: publicGuard(preview.guard, (text) => credentials.scrub(text)) };
      },
      "workbench.relativeFolder": async ({ root, folder }) => ({
        path: await workbench().relativeFolder(root, folder),
      }),
      // A previous workbench with turns still running stays open in the background (WorkbenchRuntimes).
      "workbench.create": ({ folder, name, config, instructions }) =>
        workbenchTransition(async () => {
          embeddingWarmup.cancel();
          return publicWorkbenchFolders(
            warmPrograms(
              await replaceForeground(() =>
                runtimes.create(folder, name, {
                  ...(config ? { config } : {}),
                  ...(instructions !== undefined ? { instructions } : {}),
                }),
              ),
            ),
            (text) => credentials.scrub(text),
          );
        }),
      "workbench.open": ({ folder }) =>
        workbenchTransition(async () => {
          embeddingWarmup.cancel();
          return publicWorkbenchFolders(
            warmPrograms(await replaceForeground(() => runtimes.open(folder))),
            (text) => credentials.scrub(text),
          );
        }),
      "workbench.close": async () => {
        await workbenchTransition(async () => {
          embeddingWarmup.cancel();
          browserNoticeSince = performance.now();
          await Promise.all([terminals.closeAll(), browserHost.closeAll()]);
          await runtimes.close();
        });
        return {};
      },
      "workbench.recent": async ({ remove, pin, move, reveal }) => {
        const entries = await workbench().recent(remove, pin, move);
        if (reveal !== undefined) {
          const entry = entries.find((item) => item.folder === reveal && !item.missing);
          if (!entry) throw veraError("NOT_FOUND");
          const error = await shell.openPath(entry.folder);
          if (error) throw veraError("INTERNAL");
        }
        return entries;
      },
      "workbench.config.get": async () =>
        publicWorkbenchFolders(await workbench().getConfig(), (text) => credentials.scrub(text)),
      "workbench.storage": ({ workbenchId }) => workbench().storageSize(workbenchId),
      "workbench.config.update": ({
        patch,
        workbenchId,
        removeCommandPrefixes,
        embeddingSwitch,
        addAdditionalFolders,
        removeAdditionalFolders,
      }) =>
        workbench()
          .updateConfig(
            workbenchPatchSchema.parse(patch),
            workbenchId,
            removeCommandPrefixes,
            {
              ...(addAdditionalFolders ? { add: addAdditionalFolders } : {}),
              ...(removeAdditionalFolders ? { remove: removeAdditionalFolders } : {}),
            },
            embeddingSwitch,
          )
          .then((value) => publicWorkbenchFolders(value, (text) => credentials.scrub(text))),
      "workbench.additionalFolders.list": async ({ workbenchId }) =>
        (await workbench().listAdditionalFolders(workbenchId)).map(({ id, path }) => ({
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
        const chosen = await workbench().chooseAdditionalFolder(path, workbenchId);
        return { id: chosen.id, label: credentials.scrub(chosen.path) };
      },
      "workbench.commandPrefixes.list": async ({ workbenchId }) =>
        (await workbench().listCommandPrefixes(workbenchId)).map(({ id, prefix }) => ({
          id,
          label: credentials.scrub(prefix),
        })),
      "workbench.pinned.get": () => workbench().getPinned(),
      "workbench.pinned.update": ({ content, workbenchId }) => workbench().updatePinned(content, workbenchId),
      "workbench.files": ({ query }) => workbench().files(query),
    },
    log: (failure) => logger.log("error", "ipc.internal", failure),
    sanitize: (value) => credentials.sanitize(value),
    ready: () => credentialsReady,
  }),
);

/** The window's session subscriptions end with its document, in every workbench runtime. */
function clearSubscriptions(): void {
  for (const runtime of runtimes.all()) runtime.sessions.clearSubscriptions();
}
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
    if (isMainFrame && !isInPlace) {
      browserNoticeSince = performance.now();
      capture.interrupt();
      clearSubscriptions();
    }
  });
  created.on("blur", () => capture.interrupt());
  recoverRenderer(created, (reason, reloading) => {
    capture.interrupt();
    logger.log("error", "window.renderer.gone", { reason, reloading });
    clearSubscriptions();
  });
  let closing = false;
  created.on("close", (event) => {
    capture.interrupt();
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
  window.webContents.on("render-process-gone", () => {
    gitStatus.stop();
    gitDiff.stop();
    gitHistory.stop();
  });
  window.on("closed", () => {
    gitStatus.stop();
    gitDiff.stop();
    gitHistory.stop();
    capture.interrupt();
    clearSubscriptions();
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
    quitting = true;
    const captureClosed = capture.close();
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
        ["browserHost", () => browserHost.shutdown()],
        ["browserRuntime", () => browserRuntime.shutdown()],
      ],
      [
        // Every workbench runtime, the background ones included (REQ-REL-436f00da).
        ["sessions", () => runtimes.closeSessions()],
        ["workbench", () => runtimes.closeWorkbenches()],
        ["fileWorkers", () => fileWorkers.dispose()],
        ["indexer", () => indexer.close()],
        ["fileProbe", () => closeFileProbe?.()],
        ["modelGateway", () => modelGateway.close()],
        ["chatgpt", () => chatgpt.close()],
        ["providers", () => providers.close()],
        ["webAccess", () => webAccess.close()],
        ["partsAccess", () => partsAccess.close()],
        ["credentials", () => credentials.close()],
        ["dictation capture", () => captureClosed],
        ["dictation", () => dictation.close()],
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
      secureSession(session.defaultSession, {
        target: focusedRenderer,
        permit: (request) => capture.permitAudio(request),
      });
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
      void dictation.recover().catch(() => logger.log("error", "dictation.recovery.failed"));
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
        preferences: () => ({
          ...settings.get().settings.updates,
          intervalHours: appAdvanced("updateInterval"),
        }),
        emit: (event) => emitAppEvent({ topic: "app", id: "app", event }),
        beginShutdown: () => runtimes.beginShutdown(),
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
      if (__VERA_TEST__ && browserFixture) {
        const { browserFixtureApi } = await import("./browser/fixture.js");
        Object.assign(globalThis, {
          veraTestBrowser: browserFixtureApi(
            browserRuntime,
            browserHost,
            browserAccess,
            browserFixture,
            () => workbench().getSnapshot().config.id,
            async () => {
              await settings.update({ interactiveBrowser: true });
              const { config } = workbench().getSnapshot();
              if (!config.interactive_browser)
                await workbench().updateConfig({ interactive_browser: true }, config.id);
            },
          ),
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
          contextWindow: 131072,
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
          responseTimeoutMs: (ref) => select(splitModelReference(ref).provider).responseTimeoutMs?.(ref),
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
