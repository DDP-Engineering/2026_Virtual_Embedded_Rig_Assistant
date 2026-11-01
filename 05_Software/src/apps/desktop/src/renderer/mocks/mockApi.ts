import {
  type AppEvent,
  type AppInfo,
  appEventSchema,
  type Channel,
  type ChatgptStatus,
  channels,
  configWarnings,
  defaultSettings,
  documentPatternFolder,
  type EventEnvelope,
  eventEnvelopeSchema,
  isChannel,
  mergeSettings,
  mergeWorkbench,
  modelReferenceSchema,
  moveRecentWorkbench,
  moveSession,
  opensExternally,
  orderSessions,
  type PluginInstalled,
  providerSlug,
  type Request,
  type Response,
  type SessionSummary,
  settingsPatchSchema,
  skillTemplate,
  type UpdateSnapshot,
  veraError,
  type WebProviderId,
  type WorkbenchSnapshot,
  webProviderIds,
  webProviders,
  workbenchSchema,
  workbenchTemplate,
} from "@vera/shared";
import type { VeraApi } from "../api/client.js";
import { createSubscriptions } from "../api/subscriptions.js";
import { mockDocument, mockDocuments } from "./documents.js";
import { mockAppInfo } from "./fixtures.js";
import { MockSessions } from "./sessions.js";

const openAiFixture = {
  id: "mock-openai",
  name: "Mock OpenAI model",
  reference: "openai/mock-openai",
  contextWindow: 32768,
  maxOutputTokens: 4096,
  safetyMargin: 1639,
  inputBudget: 27033,
};

export function createMockApi(
  info: AppInfo = mockAppInfo,
  scenario: "empty" | "missing" | "read-only" | "warnings" | "chat" = "empty",
): {
  api: VeraApi;
  emitAppEvent: (event: AppEvent) => void;
} {
  const subscribers = new Set<{ topic: string; id: string | undefined; on: (event: unknown) => void }>();
  let chatgpt: ChatgptStatus = { connected: false, state: "idle" };
  let authSequence = 0;
  let indexerState: "running" | "stopped" = "running";
  // The mock workbench's files for the Docs tree: its documents plus a few files that are not.
  const treeFiles = () =>
    scenario === "empty"
      ? []
      : [
          ...mockDocuments.map((doc) => doc.path),
          "firmware/main.c",
          "firmware/drivers/i2c.c",
          "manuals/rm0440-reference.txt",
          "manuals/scope-capture.png",
          ".git/config",
          ".vera/workbench.yaml",
          "node_modules/pkg/index.js",
          "node_modules/pkg/README.md",
        ];
  // What VERA hides from the agent and the index; the Docs tree lists it marked (TASK-b34f2cc7).
  const treeIgnored = (path: string) =>
    path.split("/").some((part) => [".git", ".vera", "node_modules"].includes(part.toLowerCase()));
  const treeCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  let updateState: UpdateSnapshot = {
    configured: true,
    distribution: info.portable ? "portable" : "installed",
    phase: "idle",
    offer: null,
    progress: null,
    errorCode: null,
  };
  let settings = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
  const benches = new Map<string, { snapshot: WorkbenchSnapshot; pinned: string }>();
  let active: string | undefined;
  const skillFiles = new Map<string, string>();
  /** Documentation files the mock folder picker's default folder holds, for scan and preview. */
  const boardDocs = [
    { path: "datasheets/stm32g474.pdf", bytes: 3_000_000, kind: "pdf" },
    { path: "datasheets/drv8305.pdf", bytes: 1_200_000, kind: "pdf" },
    { path: "notes/bringup.md", bytes: 4_000, kind: "markdown" },
    { path: "notes/review.docx", bytes: 60_000, kind: "office" },
    { path: "notes/old-spec.doc", bytes: 90_000, kind: "office" },
    { path: "src/main.c", bytes: 2_000 },
    { path: "Manuals (RM0440)/rm0440.pdf", bytes: 9_000_000, kind: "pdf" },
  ];
  const docFiles = new Map<string, { path: string; bytes: number; kind?: string }[]>([
    ["/mock/docs-board", boardDocs],
    ["/mock/docs-editor", boardDocs],
    [
      "/mock/new-board",
      [
        { path: "datasheets/stm32g474.pdf", bytes: 3_000_000, kind: "pdf" },
        { path: "datasheets/drv8305.pdf", bytes: 1_200_000, kind: "pdf" },
        { path: "notes/bringup.md", bytes: 4_000, kind: "markdown" },
        { path: "notes/review.docx", bytes: 60_000, kind: "office" },
        { path: "src/main.c", bytes: 2_000 },
      ],
    ],
  ]);
  /** Folders that already hold .vera/WORKBENCH.md without being a workbench. */
  const folderNotes = new Map([["/mock/with-notes", "Existing bench notes\n"]]);
  /** Installed plugins by id; install names the plugin after the chosen folder or zip. */
  const installedPlugins = new Map<string, PluginInstalled>();
  /** Later prefixes shadow earlier ones, as workbench skills shadow user skills. */
  function skillSummaries(prefixes: string[], disabled: readonly string[]) {
    const names = new Map<string, { content: string; source: "user" | "workbench" }>();
    for (const prefix of prefixes)
      for (const [key, content] of skillFiles)
        if (key.startsWith(`${prefix}:`))
          names.set(key.slice(prefix.length + 1), {
            content,
            source: prefix === "user" ? "user" : "workbench",
          });
    return [...names]
      .map(([name, { content, source }]) => {
        const match = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---/.exec(content);
        const error = !match
          ? "frontmatter"
          : match[1] !== name || !/^[a-z0-9-]{1,64}$/.test(name)
            ? "name"
            : !match[2]?.trim() || match[2].length > 1024
              ? "description"
              : undefined;
        return {
          name,
          source,
          description: error ? "" : (match?.[2] ?? ""),
          enabled: !disabled.includes(name),
          ...(error ? { error } : {}),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async function skillHash(content: string) {
    return Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  }
  function skillKey(source: string, name: string) {
    return `${source === "user" ? "user" : current().snapshot.config.id}:${name}`;
  }
  let sequence = 0;
  const webKeyConfigured: Record<WebProviderId, boolean> = { exa: false, tavily: false, brave: false };
  // Browser fixtures keep metadata only; production secrets are handled by desktop main.
  const providerHints = new Map<string, string | null>();
  if (scenario !== "empty") {
    const config = workbenchSchema.parse({
      format: 1,
      id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      name: "VERA-DEMO-01",
      vendor: { extension: true },
    });
    const snapshot: WorkbenchSnapshot = {
      folder: "/mock/demo-board",
      config,
      readOnly: scenario === "read-only",
      warnings:
        scenario === "warnings" ? [...configWarnings(config), { code: "NETWORK_SHARE_UNSUPPORTED" }] : [],
    };
    if (scenario !== "missing") benches.set(snapshot.folder, { snapshot, pinned: "ă".repeat(9000) });
    settings = mergeSettings(settings, {
      recentWorkbenches: [
        { folder: snapshot.folder, id: config.id, name: config.name, lastOpened: "2026-10-11T00:00:00Z" },
      ],
    });
  }
  function emit(envelope: EventEnvelope) {
    const parsed = eventEnvelopeSchema.parse(envelope);
    for (const subscriber of subscribers)
      if (subscriber.topic === parsed.topic && (parsed.topic === "app" || subscriber.id === parsed.id)) {
        try {
          subscriber.on(structuredClone(parsed.event));
        } catch {
          /* observer isolation */
        }
      }
  }
  function emitAppEvent(event: AppEvent) {
    emit({ topic: "app", id: "app", event: appEventSchema.parse(event) });
  }
  function current() {
    const value = active ? benches.get(active) : undefined;
    if (!value) throw veraError("NOT_FOUND");
    return value;
  }
  const sessions = new MockSessions(
    () => {
      const snapshot = current().snapshot;
      return {
        id: snapshot.config.id,
        readOnly: snapshot.readOnly,
        model: snapshot.config.agent.model ?? settings.defaultModel,
        mode: snapshot.config.agent.permission_mode,
      };
    },
    (reference) => {
      const connection = settings.providers.custom.find((p) => reference.startsWith(`custom:${p.slug}/`));
      const id = connection && reference.slice(`custom:${connection.slug}/`.length);
      return connection?.protocol === "lmstudio"
        ? (connection.models?.find((m) => m.id === id)?.reasoningOptions ?? [])
        : [];
    },
  );
  function pinned(content: string) {
    return { content, oversized: new TextEncoder().encode(content).byteLength > 16384 };
  }
  function remember(snapshot: WorkbenchSnapshot) {
    // Like main: a listed workbench keeps its place, a new one goes first.
    const recent = settings.recentWorkbenches;
    const index = recent.findIndex((entry) => entry.folder === snapshot.folder);
    const entry = {
      ...recent[index],
      folder: snapshot.folder,
      name: snapshot.config.name,
      id: snapshot.config.id,
      lastOpened: new Date().toISOString(),
    };
    settings = mergeSettings(settings, {
      recentWorkbenches: index < 0 ? [entry, ...recent] : recent.map((e, at) => (at === index ? entry : e)),
    });
    emitAppEvent({ type: "settings.changed" });
  }
  async function invoke<C extends Channel>(channel: C, request: Request<C>): Promise<Response<C>> {
    if (!isChannel(channel)) throw veraError("NOT_FOUND");
    const input = channels[channel].request.safeParse(request);
    if (!input.success) throw veraError("INVALID");
    let value: unknown;
    if (
      (channel === "session.list" || channel === "session.search" || channel === "session.create") &&
      "workbenchId" in input.data &&
      input.data.workbenchId &&
      current().snapshot.config.id !== input.data.workbenchId
    )
      throw veraError("CONFLICT");
    if (channel === "session.list" && scenario === "chat") sessions.seedFixtures();
    if (channel === "session.move") {
      const { workbenchId, sessionId, offset } = channels["session.move"].request.parse(input.data);
      if (current().snapshot.config.id !== workbenchId) throw veraError("CONFLICT");
      const list = sessions.invoke("session.list", {}) as SessionSummary[];
      if (scenario === "read-only") throw veraError("DENIED");
      const order = moveSession(list, settings.sessionOrder?.[workbenchId], sessionId, offset);
      settings = mergeSettings(settings, {
        sessionOrder: { ...settings.sessionOrder, [workbenchId]: order },
      });
      emitAppEvent({ type: "settings.changed" });
      return channels[channel].response.parse({}) as Response<C>;
    }
    if (channel === "session.list") {
      const list = sessions.invoke(channel, input.data) as SessionSummary[];
      const order = settings.sessionOrder?.[current().snapshot.config.id];
      return channels[channel].response.parse(orderSessions(list, order)) as Response<C>;
    }
    if (channel.startsWith("session.") || channel.startsWith("changes.") || channel.startsWith("artifacts."))
      return channels[channel].response.parse(sessions.invoke(channel, input.data)) as Response<C>;
    switch (channel) {
      case "update.get":
        value = updateState;
        break;
      case "update.check":
        updateState = {
          ...updateState,
          phase: "available",
          errorCode: null,
          offer: {
            version: "0.0.1",
            notes: "Update release notes",
            link: "https://updates.example.test/VERA.exe",
          },
        };
        emitAppEvent({
          type: "update.available",
          version: updateState.offer?.version ?? "",
          notes: updateState.offer?.notes ?? "",
        });
        emitAppEvent({ type: "update.changed", snapshot: updateState });
        value = updateState;
        break;
      case "update.download":
        if (updateState.distribution !== "installed") throw veraError("DENIED");
        if (updateState.phase !== "available") throw veraError("CONFLICT");
        updateState = { ...updateState, phase: "ready", progress: 100 };
        emitAppEvent({ type: "update.changed", snapshot: updateState });
        value = updateState;
        break;
      case "update.restart":
        if (updateState.distribution !== "installed") throw veraError("DENIED");
        if (updateState.phase !== "ready") throw veraError("CONFLICT");
        value = updateState;
        break;
      case "update.openRelease":
        if (
          updateState.distribution !== "portable" ||
          !updateState.offer ||
          channels["update.openRelease"].request.parse(input.data).version !== updateState.offer.version
        )
          throw veraError("DENIED");
        value = updateState;
        break;
      case "skills.list": {
        const { workbenchId } = channels["skills.list"].request.parse(input.data);
        const wb = current().snapshot;
        if (workbenchId !== wb.config.id) throw veraError("CONFLICT");
        value = skillSummaries(["user", wb.config.id], wb.config.skills.disabled);
        break;
      }
      case "workbench.scanDocs": {
        const { folder } = channels["workbench.scanDocs"].request.parse(input.data);
        if (folder === "/mock/locked-board") throw veraError("DENIED");
        const folders = new Map<string, { bytes: number; kinds: Record<string, number> }>();
        for (const file of docFiles.get(folder) ?? []) {
          const [name] = file.path.split("/");
          if (!name || !file.kind) continue;
          const entry = folders.get(name) ?? { bytes: 0, kinds: {} };
          entry.bytes += file.bytes;
          entry.kinds[file.kind] = (entry.kinds[file.kind] ?? 0) + 1;
          folders.set(name, entry);
        }
        value = {
          folders: [...folders]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([path, entry]) => ({ path, ...entry })),
          truncated: false,
        };
        break;
      }
      case "workbench.previewDocs": {
        const { folder, include, exclude } = channels["workbench.previewDocs"].request.parse(input.data);
        // Prefix matching stands in for ingest globs: "<folder>/**", "<folder>" and "**".
        const prefix = (pattern: string) =>
          documentPatternFolder(pattern) ?? pattern.replace(/\/?\*\*$/, "").replace(/\/$/, "");
        const matches = (patterns: string[], path: string) =>
          patterns.some((p) => p.trim() && (!prefix(p) || path.startsWith(`${prefix(p)}/`)));
        const result = { files: 0, bytes: 0, officePending: 0, truncated: false };
        for (const file of docFiles.get(folder) ?? [])
          if (matches(include, file.path) && !matches(exclude, file.path)) {
            // Modern office files are indexed; legacy binary formats and RTF stay pending.
            if (file.kind === "office" && /\.(doc|ppt|xls|rtf)$/.test(file.path)) result.officePending++;
            else {
              result.files++;
              result.bytes += file.bytes;
            }
          }
        value = result;
        break;
      }
      case "workbench.relativeFolder": {
        const { root, folder } = channels["workbench.relativeFolder"].request.parse(input.data);
        if (!folder.startsWith(`${root}/`)) throw veraError("DENIED");
        value = { path: folder.slice(root.length + 1) };
        break;
      }
      case "workbench.inspect": {
        const { folder } = channels["workbench.inspect"].request.parse(input.data);
        value = {
          folder,
          name: folder.split(/[\\/]/).filter(Boolean).at(-1) ?? "",
          existing: benches.has(folder),
          instructions: benches.get(folder)?.pinned ?? folderNotes.get(folder) ?? null,
          skills: skillSummaries(["user"], []),
        };
        break;
      }
      case "skills.open":
      case "skills.create":
      case "skills.save": {
        const request = channels["skills.open"].request.parse({
          workbenchId: (input.data as Request<"skills.open">).workbenchId,
          name: (input.data as Request<"skills.open">).name,
          source: (input.data as Request<"skills.open">).source,
        });
        if (request.workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        if (channel !== "skills.open" && current().snapshot.readOnly) throw veraError("DENIED");
        const key = skillKey(request.source, request.name);
        let content = skillFiles.get(key);
        if (channel === "skills.create") {
          if (content !== undefined) throw veraError("CONFLICT");
          content = skillTemplate(request.name);
          skillFiles.set(key, content);
        }
        if (content === undefined) throw veraError("NOT_FOUND");
        if (channel === "skills.save") {
          const edit = channels["skills.save"].request.parse(input.data);
          if (edit.sha256 !== (await skillHash(content))) throw veraError("CONFLICT");
          content = edit.content;
          skillFiles.set(key, content);
        }
        value = { content, sha256: await skillHash(content) };
        break;
      }
      case "skills.toggle": {
        const request = channels["skills.toggle"].request.parse(input.data);
        const wb = current().snapshot;
        if (request.workbenchId !== wb.config.id) throw veraError("CONFLICT");
        if (wb.readOnly) throw veraError("DENIED");
        const disabled = wb.config.skills.disabled.filter((name) => name !== request.name);
        if (!request.enabled) disabled.push(request.name);
        wb.config = mergeWorkbench(wb.config, { skills: { disabled } });
        emit({
          topic: "workbench",
          id: wb.config.id,
          event: { type: "config.changed", config: wb.config, warnings: wb.warnings },
        });
        value = {};
        break;
      }
      case "plugins.list": {
        const { workbenchId } = channels["plugins.list"].request.parse(input.data);
        const enabled = workbenchId ? current().snapshot.config.plugins.enabled : [];
        if (workbenchId && workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        value = [...installedPlugins.values()].map((plugin) => ({
          ...plugin,
          enabled: enabled.includes(plugin.id),
        }));
        break;
      }
      case "plugins.install": {
        const { path } = channels["plugins.install"].request.parse(input.data);
        const id = (path.split(/[\\/]/).pop() ?? "").replace(/\.zip$/i, "");
        if (!/^[a-z0-9-]{1,64}$/.test(id))
          throw { ...veraError("INVALID"), params: { issue: "id", path: "id" } };
        const plugin: PluginInstalled = {
          id,
          issues: [],
          version: "1.0.0",
          name: id,
          description: `Mock plugin installed from ${path}.`,
          ecosystem: "general",
          platforms: ["windows-x64", "linux-x64"],
          tier: "local",
          source: /\.zip$/i.test(path) ? "zip" : "folder",
          sha256: "0".repeat(64),
          installedAt: new Date().toISOString(),
        };
        installedPlugins.set(id, plugin);
        value = plugin;
        break;
      }
      case "plugins.uninstall": {
        const { id } = channels["plugins.uninstall"].request.parse(input.data);
        if (!installedPlugins.delete(id)) throw veraError("NOT_FOUND");
        value = {};
        break;
      }
      case "plugins.toggle": {
        const request = channels["plugins.toggle"].request.parse(input.data);
        const wb = current().snapshot;
        if (request.workbenchId !== wb.config.id) throw veraError("CONFLICT");
        if (wb.readOnly) throw veraError("DENIED");
        const kept = wb.config.plugins.enabled.filter((id) => id !== request.id);
        wb.config = mergeWorkbench(wb.config, {
          plugins: { enabled: request.enabled ? [...kept, request.id] : kept },
        });
        emit({
          topic: "workbench",
          id: wb.config.id,
          event: { type: "config.changed", config: wb.config, warnings: wb.warnings },
        });
        value = {};
        break;
      }
      case "docs.reindex": {
        if (current().snapshot.readOnly) throw veraError("DENIED");
        const { workbenchId } = channels["docs.reindex"].request.parse(input.data);
        if (workbenchId && workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        emit({
          topic: "workbench",
          id: current().snapshot.config.id,
          event: { type: "index.progress", pending: 2, done: 0, failed: 0 },
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        emit({
          topic: "workbench",
          id: current().snapshot.config.id,
          event: { type: "index.progress", pending: 0, done: 8, failed: 1 },
        });
        value = {};
        break;
      }
      case "docs.list": {
        const { workbenchId } = channels["docs.list"].request.parse(input.data);
        if (workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        value = { workbenchId, documents: scenario === "empty" ? [] : mockDocuments };
        break;
      }
      case "indexer.status":
        value = { state: indexerState };
        break;
      case "indexer.restart":
        indexerState = "running";
        emitAppEvent({ type: "indexer.status", state: indexerState });
        value = {};
        break;
      case "docs.tree": {
        const { workbenchId, path } = channels["docs.tree"].request.parse(input.data);
        if (workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        const prefix = path ? `${path}/` : "";
        if (path && !treeFiles().some((file) => file.startsWith(prefix))) throw veraError("NOT_FOUND");
        const folders = new Set<string>(),
          files = new Set<string>();
        for (const file of treeFiles()) {
          if (!file.startsWith(prefix)) continue;
          const [first, ...rest] = file.slice(prefix.length).split("/");
          if (first) (rest.length ? folders : files).add(first);
        }
        const sorted = (names: Set<string>) => [...names].sort(treeCollator.compare);
        value = {
          workbenchId,
          path,
          entries: [
            ...sorted(folders).map((name) => ({
              name,
              path: prefix + name,
              type: "folder",
              ignored: treeIgnored(prefix + name),
            })),
            ...sorted(files).map((name) => ({
              name,
              path: prefix + name,
              type: "file",
              ignored: treeIgnored(prefix + name),
            })),
          ],
          truncated: false,
        };
        break;
      }
      case "docs.find": {
        const { workbenchId, query } = channels["docs.find"].request.parse(input.data);
        if (workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        const needle = query.trim().toLowerCase();
        const paths = treeFiles()
          .filter((file) => !treeIgnored(file) && file.toLowerCase().includes(needle))
          .sort(treeCollator.compare);
        value = { workbenchId, paths: paths.slice(0, 200), truncated: paths.length > 200 };
        break;
      }
      case "docs.read": {
        const { workbenchId, path } = channels["docs.read"].request.parse(input.data);
        if (workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        if (!treeFiles().includes(path)) throw veraError("NOT_FOUND");
        if (/\.(pdf|docx|pptx|xlsx|odt|odp|ods)$/i.test(path))
          throw { code: "INVALID", messageKey: "documents.textBinary" };
        const lines = path === "firmware/main.c" ? ["int main(void) {", "  return 0;", "}"] : [`// ${path}`];
        value = {
          workbenchId,
          content: { kind: "text", path, ref: null, snippet: "", lines, start: 1, end: lines.length },
        };
        break;
      }
      case "docs.stat": {
        const { workbenchId, path } = channels["docs.stat"].request.parse(input.data);
        if (workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        const modified = "2026-10-13T00:00:00.000Z";
        if (treeFiles().includes(path)) {
          const size = mockDocuments.find((doc) => doc.path === path)?.bytes ?? 42;
          value = { workbenchId, properties: { path, type: "file", size, modified } };
        } else if (treeFiles().some((file) => file.startsWith(`${path}/`))) {
          value = { workbenchId, properties: { path, type: "folder", size: null, modified } };
        } else throw veraError("NOT_FOUND");
        break;
      }
      case "docs.openers":
        channels["docs.openers"].request.parse(input.data);
        value = { apps: ["vscode", "notepadpp", "terminal"] };
        break;
      case "docs.systemApps":
      case "docs.openSystemApp": {
        const request =
          channel === "docs.systemApps"
            ? channels["docs.systemApps"].request.parse(input.data)
            : channels["docs.openSystemApp"].request.parse(input.data);
        if (request.workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        if (!treeFiles().includes(request.path))
          throw veraError(
            treeFiles().some((f) => f.startsWith(`${request.path}/`)) ? "INVALID" : "NOT_FOUND",
          );
        // Linux registers two applications for PNG images in the mock.
        const apps = request.path.endsWith(".png")
          ? [
              { id: "org.gnome.eog.desktop", name: "Image Viewer" },
              { id: "gimp.desktop", name: "GNU Image Manipulation Program" },
            ]
          : [];
        if ("app" in request && !apps.some((app) => app.id === request.app)) throw veraError("INVALID");
        value = channel === "docs.systemApps" ? { apps } : {};
        break;
      }
      case "docs.openWith":
      case "docs.reveal":
      case "docs.copyPath": {
        const { workbenchId, path } =
          channel === "docs.openWith"
            ? channels["docs.openWith"].request.parse(input.data)
            : channel === "docs.reveal"
              ? channels["docs.reveal"].request.parse(input.data)
              : channels["docs.copyPath"].request.parse(input.data);
        if (workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        if (!treeFiles().some((file) => file === path || file.startsWith(`${path}/`)))
          throw veraError("NOT_FOUND");
        value = {};
        break;
      }
      case "docs.volume": {
        const { workbenchId } = channels["docs.volume"].request.parse(input.data);
        if (workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        const documents = scenario === "empty" ? [] : mockDocuments;
        value = {
          workbenchId,
          volume: { files: documents.length, bytes: documents.reduce((sum, doc) => sum + doc.bytes, 0) },
        };
        break;
      }
      case "downloads.list": {
        const { workbenchId } = channels["downloads.list"].request.parse(input.data);
        if (workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        value = { workbenchId, downloads: [] };
        break;
      }
      case "downloads.open": {
        const { workbenchId } = channels["downloads.open"].request.parse(input.data);
        if (workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        throw veraError("NOT_FOUND");
      }
      case "downloads.reveal":
        channels["downloads.reveal"].request.parse(input.data);
        throw veraError("NOT_FOUND");
      case "docs.search": {
        const { workbenchId, query } = channels["docs.search"].request.parse(input.data);
        if (workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        value = {
          workbenchId,
          results: /power|3\.3|reset/i.test(query)
            ? [{ path: "docs/a.md", ref: "docs/a.md#h=power", snippet: "3.3 V supply", score: 1 }]
            : [],
        };
        break;
      }
      case "docs.open": {
        const request = channels["docs.open"].request.parse(input.data);
        if (request.workbenchId !== current().snapshot.config.id) throw veraError("CONFLICT");
        if ("sessionId" in request) {
          const snapshot = channels["session.get"].response.parse(
            sessions.invoke("session.get", request),
          ).snapshot;
          if (
            !snapshot.items.some(
              (i) =>
                i.kind === "assistant" &&
                i.id === request.messageId &&
                !i.streaming &&
                i.citations.some((c) => c.ref === request.ref && c.valid),
            )
          )
            throw veraError("NOT_FOUND");
        }
        value = {
          workbenchId: request.workbenchId,
          content: mockDocument("path" in request ? request.path : request.ref, "path" in request),
        };
        break;
      }
      case "app.openExternal":
        value = {};
        break;
      case "web.access.get":
        value = {
          preferences: settings.webAccess,
          keys: Object.fromEntries(
            webProviderIds.map((id) => [
              id,
              { keyConfigured: webKeyConfigured[id], storage: webKeyConfigured[id] ? "memory" : null },
            ]),
          ),
          secureStorage: true,
        };
        break;
      case "web.access.save": {
        if (scenario === "read-only") throw veraError("DENIED");
        const request = channels["web.access.save"].request.parse(input.data);
        if (
          request.enabled &&
          request.authentication === "api-key" &&
          !request.apiKey &&
          !webKeyConfigured[request.provider]
        )
          throw veraError("INVALID");
        webKeyConfigured[request.provider] ||= !!request.apiKey;
        settings = mergeSettings(settings, {
          webAccess: {
            enabled: request.enabled,
            provider: request.provider,
            authentication: request.authentication,
          },
        });
        emitAppEvent({ type: "settings.changed" });
        value = { status: "saved" };
        break;
      }
      case "web.access.removeKey": {
        if (scenario === "read-only") throw veraError("DENIED");
        const { provider } = channels["web.access.removeKey"].request.parse(input.data);
        webKeyConfigured[provider] = false;
        if (settings.webAccess.provider === provider)
          settings = mergeSettings(settings, {
            webAccess: {
              ...settings.webAccess,
              authentication: webProviders[provider].anonymous ? "anonymous" : "api-key",
              enabled: webProviders[provider].anonymous && settings.webAccess.enabled,
            },
          });
        emitAppEvent({ type: "settings.changed" });
        value = {};
        break;
      }
      case "web.access.test": {
        const request = channels["web.access.test"].request.parse(input.data);
        value = {
          testId: request.testId,
          provider: request.provider,
          authentication: request.authentication,
          checkedAt: "2026-10-30T12:00:00Z",
          durationMs: 15,
          status: !settings.webAccess.enabled
            ? "disabled"
            : request.authentication === "api-key" && !request.apiKey && !webKeyConfigured[request.provider]
              ? "key-required"
              : "pass",
        };
        break;
      }
      case "web.access.cancel":
        value = {};
        break;
      case "providers.chatgpt.status":
        value = chatgpt;
        break;
      case "providers.chatgpt.login": {
        const request = channels["providers.chatgpt.login"].request.parse(input.data);
        if ("manualCode" in request) {
          if (chatgpt.state !== "manual" || chatgpt.promptId !== request.promptId)
            throw veraError("CONFLICT");
          chatgpt = { connected: true, state: "idle", expiresAt: "2033-05-18T03:33:20.000Z" };
          if (settings.defaultModel === null)
            settings = mergeSettings(settings, { defaultModel: "chatgpt/mock-subscription" });
          emitAppEvent({ type: "settings.changed" });
        } else {
          if (chatgpt.state === "manual") throw veraError("BUSY");
          chatgpt = { ...chatgpt, state: "manual", promptId: String(++authSequence) };
        }
        value = chatgpt;
        break;
      }
      case "providers.chatgpt.cancel":
        chatgpt = { ...chatgpt, state: "idle", promptId: undefined };
        value = {};
        break;
      case "providers.chatgpt.logout": {
        chatgpt = { connected: false, state: "idle" };
        if (settings.defaultModel?.startsWith("chatgpt/"))
          settings = mergeSettings(settings, { defaultModel: null });
        emitAppEvent({ type: "settings.changed" });
        value = {};
        break;
      }

      case "app.openPath": {
        current();
        const { path } = channels["app.openPath"].request.parse(input.data);
        // Like PathGuard: what VERA ignores never reaches the default application.
        if (!opensExternally(path) || treeIgnored(path) || path.split("/").includes(".."))
          throw veraError("DENIED");
        value = {};
        break;
      }
      case "app.revealPath": {
        current();
        const { path } = input.data as Request<"app.revealPath">;
        if (
          path.startsWith("/") ||
          /[\\:\0]/.test(path) ||
          path.split("/").includes("..") ||
          path.startsWith(".vera/")
        )
          throw veraError("DENIED");
        value = sessions.reveal(path);
        break;
      }
      case "providers.discover": {
        const request = channels["providers.discover"].request.parse(input.data);
        value = {
          baseUrl: `${new URL(request.endpoint).origin}/v1`,
          models: [
            {
              id: "mock-local",
              name: "Mock local",
              maxContextWindow: 262144,
              loadedContextWindow: 65536,
              supportsTools: true,
              reasoningOptions: ["off", "on", "low", "medium", "high"],
              reasoningDefault: "on",
            },
            { id: "mock-small", name: "Mock small", maxContextWindow: 32768, reasoningOptions: [] },
          ],
        };
        break;
      }
      case "providers.models": {
        const { id } = input.data as Request<"providers.models">;
        if (id === "chatgpt") {
          if (!chatgpt.connected) throw veraError("PROVIDER");
          value = {
            reachability: "skipped",
            models: [
              {
                ...openAiFixture,
                id: "mock-subscription",
                name: "Mock subscription model",
                reference: "chatgpt/mock-subscription",
              },
            ],
          };
        } else if (id === "openai") {
          value = { reachability: "skipped", models: [openAiFixture] };
        } else {
          const config = settings.providers.custom.find((c) => `custom:${c.slug}` === id);
          if (!config) throw veraError("NOT_FOUND");
          value = {
            reachability: "pass",
            models: (
              config.models ?? [
                {
                  id: config.model,
                  name: config.model,
                  contextWindow: config.contextWindow,
                  maxOutputTokens: config.maxOutputTokens,
                  supportsTools: config.supportsTools,
                },
              ]
            ).map((profile) => {
              const safetyMargin = Math.max(1024, Math.ceil(profile.contextWindow * 0.05));
              return {
                id: profile.id,
                name: profile.name,
                reference: `${id}/${profile.id}`,
                contextWindow: profile.contextWindow,
                maxOutputTokens: profile.maxOutputTokens,
                safetyMargin,
                inputBudget: profile.contextWindow - profile.maxOutputTokens - safetyMargin,
                ...(profile.supportsTools === undefined ? {} : { supportsTools: profile.supportsTools }),
              };
            }),
          };
        }
        break;
      }
      case "providers.test": {
        const { id, model } = input.data as Request<"providers.test">;
        const custom = settings.providers.custom.find((c) => `custom:${c.slug}` === id);
        if (id !== "openai" && !custom) throw veraError("NOT_FOUND");
        const selected = model ?? (id === "openai" ? settings.providers.openai.model : custom?.model);
        const valid = modelReferenceSchema.safeParse(`${id}/${selected ?? ""}`).success;
        const supported = id !== "openai" || selected === openAiFixture.id;
        const hasAuth = id !== "openai" || providerHints.has(id);
        const authenticated = valid && supported && hasAuth;
        const authError = { code: "PROVIDER", messageKey: "provider.auth", params: { reason: "auth" } };
        const error = !valid ? veraError("INVALID") : !supported ? veraError("NOT_FOUND") : authError;
        const tools = custom?.supportsTools !== false;
        value = {
          steps: [
            {
              step: "reachability",
              status: hasAuth ? "pass" : "fail",
              ...(hasAuth ? {} : { error: authError }),
            },
            {
              step: "authentication",
              status: authenticated ? "pass" : "fail",
              ...(authenticated ? {} : { error }),
            },
            {
              step: "tools",
              status: authenticated ? (tools ? "pass" : "fail") : "skipped",
              ...(authenticated && !tools ? { error: veraError("PROVIDER") } : {}),
            },
            { step: "streaming", status: authenticated ? "pass" : "skipped" },
          ],
        };
        if (custom && authenticated && (!model || model === custom.model)) {
          custom.supportsTools = tools;
          emitAppEvent({ type: "settings.changed" });
        }
        break;
      }
      case "providers.list": {
        const meta = (id: string, keyless = false) => ({
          configured: keyless || providerHints.has(id),
          hint: providerHints.get(id) ?? null,
          storage: providerHints.has(id) ? "memory" : null,
        });
        value = {
          openai: { id: "openai", ...settings.providers.openai, ...meta("openai") },
          custom: settings.providers.custom.map((c) => ({
            ...c,
            id: `custom:${c.slug}`,
            ...meta(`custom:${c.slug}`, true),
          })),
          secureStorage: true,
        };
        break;
      }
      case "providers.save": {
        const request = channels["providers.save"].request.parse(input.data);
        let id = "openai";
        const providers = structuredClone(settings.providers);
        if (request.provider === "openai") {
          if (request.model === "") delete providers.openai.model;
          else if (request.model !== undefined)
            providers.openai = { ...providers.openai, model: request.model };
        } else {
          const found = request.id
            ? providers.custom.findIndex((c) => `custom:${c.slug}` === request.id)
            : -1;
          if (request.id && found < 0) throw veraError("NOT_FOUND");
          const slug = found >= 0 ? providers.custom[found]?.slug : providerSlug(request.config.name);
          if (!slug) throw veraError("INVALID");
          if (
            providers.custom.some(
              (c, i) =>
                i !== found &&
                (c.name.toLowerCase() === request.config.name.toLowerCase() || c.slug === slug),
            )
          )
            throw veraError("CONFLICT");
          id = `custom:${slug}`;
          const config = { ...(found >= 0 ? providers.custom[found] : {}), ...request.config, slug };
          if (found >= 0) providers.custom[found] = config;
          else providers.custom.push(config);
        }
        settings = mergeSettings(settings, { providers });
        if (request.apiKey !== undefined) {
          if (request.apiKey) {
            const characters = [...request.apiKey];
            const hint =
              characters.length <= 7
                ? null
                : `${characters.slice(0, 3).join("")}…${characters.slice(-4).join("")}`;
            providerHints.set(id, hint === request.apiKey ? null : hint);
          } else providerHints.delete(id);
        }
        emitAppEvent({ type: "settings.changed" });
        value = { status: "saved" };
        break;
      }
      case "providers.remove": {
        const { id } = channels["providers.remove"].request.parse(input.data);
        const providers = structuredClone(settings.providers);
        if (id !== "openai") {
          if (!providers.custom.some((c) => `custom:${c.slug}` === id)) throw veraError("NOT_FOUND");
          providers.custom = providers.custom.filter((c) => `custom:${c.slug}` !== id);
        }
        settings = mergeSettings(settings, { providers });
        providerHints.delete(id);
        emitAppEvent({ type: "settings.changed" });
        value = {};
        break;
      }
      case "app.info":
        value = info;
        break;
      case "window.menu":
        value = {};
        break;
      case "app.settings.get":
        value = { settings };
        break;
      case "app.settings.update": {
        const next = mergeSettings(settings, settingsPatchSchema.parse(input.data));
        if (JSON.stringify(next) !== JSON.stringify(settings)) {
          settings = next;
          emitAppEvent({ type: "settings.changed" });
        }
        value = { settings };
        break;
      }
      case "app.chooseFolder":
        value = { folder: "/mock/new-board" };
        break;
      case "workbench.create": {
        const {
          folder,
          name,
          config: initial,
          instructions,
        } = channels["workbench.create"].request.parse(input.data);
        if (benches.has(folder)) throw veraError("CONFLICT");
        sequence++;
        const config = mergeWorkbench(
          workbenchSchema.parse({
            format: 1,
            id: `wb_01JB8Z6Q4M7N2K5R9T3V8X${String(sequence).padStart(4, "0")}`,
            name,
          }),
          initial ?? {},
        );
        const snapshot = { folder, config, readOnly: false, warnings: [] };
        benches.set(folder, {
          snapshot,
          pinned: folderNotes.get(folder) ?? instructions ?? workbenchTemplate(name),
        });
        await sessions.close();
        active = folder;
        remember(snapshot);
        emit({ topic: "workbench", id: config.id, event: { type: "opened", workbench: snapshot } });
        value = snapshot;
        break;
      }
      case "workbench.open": {
        const { folder } = channels["workbench.open"].request.parse(input.data);
        const bench = benches.get(folder);
        if (!bench) throw veraError("NOT_FOUND");
        await sessions.close();
        active = folder;
        remember(bench.snapshot);
        value = bench.snapshot;
        emit({
          topic: "workbench",
          id: bench.snapshot.config.id,
          event: { type: "opened", workbench: bench.snapshot },
        });
        break;
      }
      case "workbench.close": {
        if (active) {
          const config = current().snapshot.config;
          await sessions.close();
          active = undefined;
          emit({ topic: "workbench", id: config.id, event: { type: "closed" } });
        }
        value = {};
        break;
      }
      case "workbench.recent": {
        const { remove, pin, move, reveal } = channels["workbench.recent"].request.parse(input.data);
        if (move) {
          if (scenario === "read-only") throw veraError("DENIED");
          settings = mergeSettings(settings, {
            recentWorkbenches: moveRecentWorkbench(settings.recentWorkbenches, move.folder, move.offset),
          });
          emitAppEvent({ type: "settings.changed" });
        }
        if (pin) {
          if (scenario === "read-only") throw veraError("DENIED");
          if (!settings.recentWorkbenches.some((e) => e.folder === pin.folder)) throw veraError("NOT_FOUND");
          settings = mergeSettings(settings, {
            recentWorkbenches: settings.recentWorkbenches.map((e) =>
              e.folder === pin.folder ? { ...e, pinned: pin.value } : e,
            ),
          });
          emitAppEvent({ type: "settings.changed" });
        }
        if (reveal && !benches.has(reveal)) throw veraError("NOT_FOUND");
        if (remove) {
          settings = mergeSettings(settings, {
            recentWorkbenches: settings.recentWorkbenches.filter((e) => e.folder !== remove),
          });
          emitAppEvent({ type: "settings.changed" });
        }
        value = settings.recentWorkbenches.map((e) => ({ ...e, missing: !benches.has(e.folder) }));
        break;
      }
      case "workbench.config.get":
        value = {
          config: current().snapshot.config,
          warnings: current().snapshot.warnings,
          readOnly: current().snapshot.readOnly,
          folder: current().snapshot.folder,
        };
        break;
      case "workbench.config.update": {
        const { patch, workbenchId } = channels["workbench.config.update"].request.parse(input.data);
        const bench = current();
        if (bench.snapshot.readOnly) throw veraError("DENIED");
        if (workbenchId && bench.snapshot.config.id !== workbenchId) throw veraError("CONFLICT");
        const config = mergeWorkbench(bench.snapshot.config, patch);
        const warnings = configWarnings(config);
        if (JSON.stringify(config) !== JSON.stringify(bench.snapshot.config)) {
          bench.snapshot = { ...bench.snapshot, config, warnings };
          remember(bench.snapshot);
          emit({ topic: "workbench", id: config.id, event: { type: "config.changed", config, warnings } });
        }
        value = { config, warnings };
        break;
      }
      case "workbench.pinned.get":
        value = pinned(current().pinned);
        break;
      case "workbench.pinned.update": {
        if (current().snapshot.readOnly) throw veraError("DENIED");
        const { content, workbenchId } = channels["workbench.pinned.update"].request.parse(input.data);
        if (workbenchId && current().snapshot.config.id !== workbenchId) throw veraError("CONFLICT");
        current().pinned = content;
        value = pinned(content);
        break;
      }
      case "workbench.files": {
        current();
        const { query } = channels["workbench.files"].request.parse(input.data);
        value = [".vera/WORKBENCH.md", "docs/pinout.csv", ".vera/workbench.yaml"].filter((p) =>
          p.toLowerCase().includes(query.toLowerCase()),
        );
        break;
      }
    }
    const parsed = channels[channel].response.safeParse(value);
    if (!parsed.success) throw veraError("INTERNAL");
    return structuredClone(parsed.data) as Response<C>;
  }
  return {
    api: {
      invoke,
      getAppInfo: () => invoke("app.info", {}),
      getSettings: () => invoke("app.settings.get", {}),
      updateSettings: (patch) => invoke("app.settings.update", patch),
      subscribe: createSubscriptions(
        (topic, id, on) => {
          const subscriber = { topic, id, on };
          subscribers.add(subscriber);
          return () => {
            subscribers.delete(subscriber);
          };
        },
        (id, sinceSeq, on) => sessions.subscribe(id, sinceSeq, on),
      ),
    },
    emitAppEvent,
  };
}
export const mockApi = createMockApi(
  undefined,
  typeof location !== "undefined" && new URLSearchParams(location.search).get("mock") === "chat"
    ? "chat"
    : "empty",
).api;
