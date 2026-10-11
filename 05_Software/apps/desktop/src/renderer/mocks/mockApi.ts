import {
  type AppEvent,
  type AppInfo,
  appEventSchema,
  type Channel,
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
  veraError,
  type WorkbenchSnapshot,
  workbenchSchema,
  workbenchTemplate,
} from "@vera/shared";
import type { VeraApi } from "../api/client.js";
import { createSubscriptions } from "../api/subscriptions.js";
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
  let settings = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
  const benches = new Map<string, { snapshot: WorkbenchSnapshot; pinned: string }>();
  let active: string | undefined;
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
      ].slice(0, 10),
    });
    emitAppEvent({ type: "settings.changed" });
  }
  async function invoke<C extends Channel>(channel: C, request: Request<C>): Promise<Response<C>> {
    if (!isChannel(channel)) throw veraError("NOT_FOUND");
    const input = channels[channel].request.safeParse(request);
    if (!input.success) throw veraError("INVALID");
    let value: unknown;
    if (channel === "session.list" && scenario === "chat") sessions.seedFixtures();
    if (channel.startsWith("session."))
      return channels[channel].response.parse(sessions.invoke(channel, input.data)) as Response<C>;
    switch (channel) {
      case "providers.models": {
        const { id } = input.data as Request<"providers.models">;
        if (id === "openai") {
          value = { reachability: "skipped", models: [openAiFixture] };
        } else {
          const config = settings.providers.custom.find((c) => `custom:${c.slug}` === id);
          if (!config) throw veraError("NOT_FOUND");
          const safetyMargin = Math.max(1024, Math.ceil(config.contextWindow * 0.05));
          value = {
            reachability: "pass",
            models: [
              {
                id: config.model,
                name: config.model,
                reference: `${id}/${config.model}`,
                contextWindow: config.contextWindow,
                maxOutputTokens: config.maxOutputTokens,
                safetyMargin,
                inputBudget: config.contextWindow - config.maxOutputTokens - safetyMargin,
                ...(config.supportsTools === undefined ? {} : { supportsTools: config.supportsTools }),
              },
            ],
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
        const { remove } = channels["workbench.recent"].request.parse(input.data);
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
        const { patch } = channels["workbench.config.update"].request.parse(input.data);
        const bench = current();
        if (bench.snapshot.readOnly) throw veraError("DENIED");
        const config = mergeWorkbench(bench.snapshot.config, patch);
        const warnings = configWarnings(config);
        if (JSON.stringify(config) !== JSON.stringify(bench.snapshot.config)) {
          bench.snapshot = { ...bench.snapshot, config, warnings };
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
        const { content } = channels["workbench.pinned.update"].request.parse(input.data);
        current().pinned = content;
        value = pinned(content);
        break;
      }
      case "workbench.files": {
        current();
        const { query } = channels["workbench.files"].request.parse(input.data);
        value = ["WORKBENCH.md", "docs/pinout.csv", "workbench.yaml"].filter((p) =>
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
