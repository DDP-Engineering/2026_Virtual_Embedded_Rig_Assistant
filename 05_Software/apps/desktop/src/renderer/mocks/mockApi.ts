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

export function createMockApi(
  info: AppInfo = mockAppInfo,
  scenario: "empty" | "missing" | "read-only" | "warnings" = "empty",
): {
  api: VeraApi;
  emitAppEvent: (event: AppEvent) => void;
} {
  const subscribers = new Set<{ topic: string; id: string | undefined; on: (event: unknown) => void }>();
  let settings = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
  const benches = new Map<string, { snapshot: WorkbenchSnapshot; pinned: string }>();
  let active: string | undefined;
  let sequence = 0;
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
    switch (channel) {
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
        value = { config: current().snapshot.config, warnings: current().snapshot.warnings };
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
      subscribe: createSubscriptions((topic, id, on) => {
        const subscriber = { topic, id, on };
        subscribers.add(subscriber);
        return () => {
          subscribers.delete(subscriber);
        };
      }),
    },
    emitAppEvent,
  };
}
export const mockApi = createMockApi().api;
