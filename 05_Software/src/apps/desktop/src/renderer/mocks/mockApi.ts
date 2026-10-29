import {
  type AppEvent,
  type AppInfo,
  appEventSchema,
  type Channel,
  type ChatgptStatus,
  channels,
  configWarnings,
  defaultSettings,
  type EventEnvelope,
  eventEnvelopeSchema,
  isChannel,
  mergeSettings,
  mergeWorkbench,
  modelReferenceSchema,
  providerSlug,
  type Request,
  type Response,
  settingsPatchSchema,
  skillTemplate,
  type UpdateSnapshot,
  veraError,
  type WorkbenchSnapshot,
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
  const sessions = new MockSessions(() => {
    const snapshot = current().snapshot;
    return {
      id: snapshot.config.id,
      readOnly: snapshot.readOnly,
      model: snapshot.config.agent.model,
      mode: snapshot.config.agent.permission_mode,
    };
  });
  function pinned(content: string) {
    return { content, oversized: new TextEncoder().encode(content).byteLength > 16384 };
  }
  function remember(snapshot: WorkbenchSnapshot) {
    settings = mergeSettings(settings, {
      recentWorkbenches: [
        {
          ...settings.recentWorkbenches.find((entry) => entry.folder === snapshot.folder),
          folder: snapshot.folder,
          name: snapshot.config.name,
          id: snapshot.config.id,
          lastOpened: new Date().toISOString(),
        },
        ...settings.recentWorkbenches.filter((e) => e.folder !== snapshot.folder),
      ],
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
        const names = new Map<string, { content: string; source: "user" | "workbench" }>();
        for (const prefix of ["user", wb.config.id])
          for (const [key, content] of skillFiles)
            if (key.startsWith(`${prefix}:`))
              names.set(key.slice(prefix.length + 1), {
                content,
                source: prefix === "user" ? "user" : "workbench",
              });
        value = [...names]
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
              enabled: !wb.config.skills.disabled.includes(name),
              ...(error ? { error } : {}),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
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
          readOnly: false,
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
        value = { settings, readOnly: false };
        break;
      case "app.settings.update": {
        const next = mergeSettings(settings, settingsPatchSchema.parse(input.data));
        if (JSON.stringify(next) !== JSON.stringify(settings)) {
          settings = next;
          emitAppEvent({ type: "settings.changed" });
        }
        value = { settings, readOnly: false };
        break;
      }
      case "app.chooseFolder":
        value = { folder: "/mock/new-board" };
        break;
      case "workbench.create": {
        const { folder, name } = channels["workbench.create"].request.parse(input.data);
        if (benches.has(folder)) throw veraError("CONFLICT");
        sequence++;
        const config = workbenchSchema.parse({
          format: 1,
          id: `wb_01JB8Z6Q4M7N2K5R9T3V8X${String(sequence).padStart(4, "0")}`,
          name,
        });
        const snapshot = { folder, config, readOnly: false, warnings: [] };
        benches.set(folder, {
          snapshot,
          pinned: workbenchTemplate(name),
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
        const { remove, pin, reveal } = channels["workbench.recent"].request.parse(input.data);
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
