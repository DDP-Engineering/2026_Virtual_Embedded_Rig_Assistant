import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { type LlmGateway, SettingsService, splitModelReference, WorkbenchService } from "@vera/core";
import { eventEnvelopeSchema } from "@vera/shared";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
} from "electron";
import { getAppInfo } from "./app-info.js";
import { exportArtifact, publicArtifact, revealArtifact } from "./artifacts.js";
import { ChatgptAuth } from "./chatgpt-auth.js";
import { CredentialFile } from "./credentials.js";
import { configureDataLocations } from "./data-locations.js";
import { createDocumentServices } from "./document-processor.js";
import { publicDocument, publicDocumentHit, publicViewer } from "./document-viewer.js";
import { createEventEmitter, sanitizeSessionSnapshot, sanitizeSessionSummary } from "./events.js";
import { createFileAccess } from "./file-access.js";
import { systemClock } from "./host-ports.js";
import { createInvokeRouter } from "./ipc-router.js";
import { createLogger } from "./logger.js";
import { openExternal } from "./open-external.js";
import { ProviderGateway } from "./provider-gateway.js";
import { ProviderSettings } from "./provider-settings.js";
import { revealPath } from "./reveal-path.js";
import { bundledResponse, secureSession, secureWindow } from "./security.js";
import { SessionsHost } from "./sessions.js";
import { loadWindowState, saveWindowState } from "./window-state.js";
import { createDesktopWorkerPool } from "./worker-pool.js";

const here = dirname(fileURLToPath(import.meta.url));
declare const __VERA_DEV__: boolean;
declare const __VERA_TEST__: boolean;
app.setName("VERA");
// pi-ai's public standalone entrypoint makes its variable OAuth imports available in bundles.
registerBunOAuthFlows();
const userData = app.commandLine.getSwitchValue("user-data-dir");
const dataLocations = configureDataLocations(app, process.execPath, userData);

protocol.registerSchemesAsPrivileged([
  { scheme: "vera", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let window: BrowserWindow | undefined;
const fileWorkers = createDesktopWorkerPool();
const documents = createDocumentServices(
  app.isPackaged ? process.resourcesPath : join(here, "../../../../resources"),
);
let closeFileProbe: (() => Promise<void>) | undefined;
let rendererUrl = "vera://app/index.html";
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
  },
});
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
  documents.processDocument,
);
const providers = new ProviderSettings(settings, credentials);
let chatgpt = new ChatgptAuth({
  settings,
  credentials,
  openExternal: async (url) => {
    await openExternal({ url, confirmed: true }, (url) => shell.openExternal(url), true);
  },
});
let modelGateway = new ProviderGateway(settings, credentials, providers, systemClock);
const sessions = new SessionsHost({
  workbench,
  settings,
  gateway: () => modelGateway,
  credentials,
  clock: systemClock,
  workers: fileWorkers,
  embeddings: documents.embeddings,
  version: app.getVersion(),
  target: () =>
    window && !window.isDestroyed() ? { webContents: window.webContents, url: rendererUrl } : undefined,
  emit: emitAppEvent,
  ...(__VERA_TEST__ && process.env.VERA_TEST_ALLOW_WRITES === "1"
    ? { permissions: { allow: () => true } }
    : {}),
});
ipcMain.handle("vera:subscription", (event, action, payload) =>
  sessions.subscription(event, action, payload),
);

ipcMain.handle(
  "vera:invoke",
  createInvokeRouter({
    target: () =>
      window && !window.isDestroyed() ? { webContents: window.webContents, url: rendererUrl } : undefined,
    handlers: {
      "skills.list": ({ workbenchId }) => workbench.listSkills(workbenchId),
      "skills.open": ({ workbenchId, source, name }) => workbench.openSkill(workbenchId, source, name),
      "skills.create": ({ workbenchId, source, name }) => workbench.saveSkill(workbenchId, source, name),
      "skills.save": ({ workbenchId, source, name, content, sha256 }) =>
        workbench.saveSkill(workbenchId, source, name, content, sha256),
      "skills.toggle": ({ workbenchId, name, enabled }) => workbench.toggleSkill(workbenchId, name, enabled),
      "docs.list": async ({ workbenchId }) => ({
        workbenchId,
        documents: (await workbench.listDocuments(workbenchId))
          .map((doc) => publicDocument(doc, (text) => credentials.scrub(text)))
          .filter((doc) => doc !== undefined),
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
      "docs.reindex": async ({ workbenchId }) => {
        await workbench.reindexDocuments(workbenchId);
        return {};
      },
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
      "session.list": () =>
        sessions.run((s) =>
          s.list().map((item) => sanitizeSessionSummary(item, (text) => credentials.scrub(text))),
        ),
      "session.create": ({ modelRef, mode }) =>
        sessions.run((s) => {
          if (credentials.containsSecret(modelRef)) throw { code: "INVALID", messageKey: "errors.INVALID" };
          return sanitizeSessionSummary(s.create(modelRef, mode), (text) => credentials.scrub(text));
        }),
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
      "session.stop": ({ sessionId }) => sessions.run((s) => ({ stopped: s.stop(sessionId) })),
      "session.approval.decide": (request) =>
        sessions.run((s) => {
          s.decideApproval(request);
          return {};
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
      "providers.models": ({ id }) => modelGateway.models(id),
      "providers.test": ({ id, model }) => modelGateway.test(id, model),
      "providers.list": () => providers.list(),
      "providers.save": (request) => providers.save(request),
      "providers.remove": (request) => providers.remove(request),
      "app.info": () => getAppInfo(dataLocations.portable),
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
      "app.chooseFolder": async () => {
        if (__VERA_TEST__ && process.env.VERA_TEST_DIALOG_PATH)
          return { folder: process.env.VERA_TEST_DIALOG_PATH };
        if (!window || window.isDestroyed()) return { folder: null };
        const result = await dialog.showOpenDialog(window, {
          properties: ["openDirectory", "createDirectory"],
        });
        return { folder: result.canceled ? null : (result.filePaths[0] ?? null) };
      },
      "workbench.create": ({ folder, name }) => sessions.lifecycle(() => workbench.create(folder, name)),
      "workbench.open": ({ folder }) => sessions.lifecycle(() => workbench.open(folder)),
      "workbench.close": async () => {
        await sessions.lifecycle(() => workbench.close());
        return {};
      },
      "workbench.recent": ({ remove }) => workbench.recent(remove),
      "workbench.config.get": async () => ({
        ...(await workbench.getConfig()),
        readOnly: workbench.getSnapshot().readOnly,
        folder: workbench.getSnapshot().folder,
      }),
      "workbench.config.update": ({ patch }) => workbench.updateConfig(patch),
      "workbench.pinned.get": () => workbench.getPinned(),
      "workbench.pinned.update": ({ content }) => workbench.updatePinned(content),
      "workbench.files": ({ query }) => workbench.files(query),
    },
    log: (failure) => logger.log("error", "ipc.internal", failure),
    sanitize: (value) => credentials.sanitize(value),
  }),
);

async function createWindow(): Promise<void> {
  const stateFile = join(app.getPath("userData"), "window-state.json");
  const state = await loadWindowState(
    stateFile,
    screen.getAllDisplays().map((display) => display.workArea),
  );
  window = new BrowserWindow({
    title: "VERA",
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
    },
  });
  secureWindow(window);
  const created = window;
  created.webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) sessions.clearSubscriptions();
  });
  let closing = false;
  created.on("close", (event) => {
    if (state.readOnly) return;
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
    if (draining) return;
    draining = true;
    void sessions
      .close()
      .then(() => workbench.close())
      .then(() => fileWorkers.dispose())
      .then(() => documents.embeddings.dispose())
      .then(() => closeFileProbe?.())
      .then(() => modelGateway.close())
      .then(() => chatgpt.close())
      .then(() => providers.close())
      .then(() => credentials.close())
      .then(() => settings.close())
      .catch(() => {
        console.error("VERA shutdown persistence failed");
      })
      .finally(() => {
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
      await settings.load();
      await credentials.load();
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
        const select = (id: string) => (id === "replay" ? replay : api);
        const gateway: LlmGateway = {
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
      secureSession(session.defaultSession);
      protocol.handle("vera", (request) => bundledResponse(join(here, "../renderer"), request));
      if (__VERA_TEST__ && app.commandLine.hasSwitch("packaging-probe")) {
        const { runPackagingProbe } = await import("./packaging/probe.js");
        app.exit(await runPackagingProbe(app.commandLine.getSwitchValue("packaging-probe")));
        return;
      }
      await createWindow();
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
