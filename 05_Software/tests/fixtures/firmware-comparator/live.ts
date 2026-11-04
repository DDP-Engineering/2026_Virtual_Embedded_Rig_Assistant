// Opt-in Electron-only acceptance host. Never imported by automated/offline tests.
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { join } from "node:path";
import { createPiAiGateway } from "@vera/core";
import { settingsSchema } from "@vera/shared";
import { app, safeStorage } from "electron";
import { CredentialFile } from "../../../src/apps/desktop/src/main/credentials.js";
import { createFileAccess } from "../../../src/apps/desktop/src/main/file-access.js";
import { systemClock } from "../../../src/apps/desktop/src/main/host-ports.js";
import { subscriptionStore } from "../../../src/apps/desktop/src/main/subscription-store.js";
import { cases, runCase, sha256 } from "./harness.js";

const argument = (name: string) =>
  process.argv.find((value) => value.startsWith(`--cap03-${name}=`))?.slice(name.length + 9);
const output = argument("output"),
  profile = argument("profile"),
  worker = argument("worker"),
  selectedModel = argument("model");
if (!output || !profile || !worker) throw Error("Explicit prepared output/profile/worker required");
mkdirSync(join(output, "electron-profile"), { recursive: true });
// safeStorage keys belong to the existing VERA profile. Initialize only the normal credential
// host there; no BrowserWindow, workbench service, SettingsService or product startup is run.
// After reading credentials the acceptance host switches to its isolated profile.
app.setPath("userData", profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-networking");
const requests: { host: string; path: string; method: string; status?: number }[] = [];
const allowedHosts = new Set(["api.openai.com", "auth.openai.com"]);
const originalConnect = Socket.prototype.connect;
Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options =
    first && typeof first === "object" ? (first as { host?: string; port?: number | string }) : undefined;
  const port = options?.port ?? (typeof first === "number" ? first : undefined);
  if (port !== undefined && !allowedHosts.has(options?.host ?? String(args[1] ?? "localhost")))
    throw Error("Rubric non-provider socket blocked");
  return Reflect.apply(originalConnect, this, args);
} as typeof originalConnect;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const allowed =
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    ((url.hostname === "api.openai.com" && ["/v1/models", "/v1/responses"].includes(url.pathname)) ||
      (url.hostname === "auth.openai.com" && url.pathname === "/api/accounts/oauth/token"));
  if (!allowed) throw Error("Rubric non-provider fetch blocked");
  const receipt = { host: url.hostname, path: url.pathname, method: init?.method ?? "GET" };
  requests.push(receipt);
  const response = await originalFetch(input, { ...init, redirect: "error" });
  Object.assign(receipt, { status: response.status });
  return response;
};

void app
  .whenReady()
  .then(async () => {
    let credentials: CredentialFile | undefined;
    let exit = 2;
    let stage = "settings validation";
    const settingsPath = join(profile, "settings.json");
    const before = sha256(await readFile(settingsPath));
    try {
      const parsedSettings = settingsSchema.safeParse(JSON.parse(await readFile(settingsPath, "utf8")));
      if (!parsedSettings.success) {
        await writeFile(
          join(output, "settings-validation.json"),
          JSON.stringify(
            parsedSettings.error.issues.map(({ code, path }) => ({ code, path })),
            null,
            2,
          ),
          { flag: "wx" },
        );
        throw Error("Normal VERA settings fail current settingsSchema; see safe validation paths");
      }
      const settings = parsedSettings.data;
      // This is the production CredentialFile + Electron safeStorage + subscription adapter.
      // Settings are parsed in memory only; no SettingsService update or profile copy.
      credentials = new CredentialFile({
        file: join(profile, "credentials.json"),
        files: createFileAccess(systemClock),
        crypto: safeStorage,
        logger: { registerSecret: () => () => {}, log: () => {}, flush: async () => {} },
        platform: process.platform,
      });
      stage = "normal CredentialFile load with Electron safeStorage";
      await credentials.load();
      app.setPath("userData", join(output, "electron-profile"));
      const reference = selectedModel ?? settings.defaultModel;
      if (!reference) throw Error("No default model configured in normal VERA profile");
      await writeFile(
        join(output, "configured-model.json"),
        JSON.stringify(
          {
            configuredReference: settings.defaultModel,
            selectedReference: reference,
            selection: selectedModel
              ? "explicit user-authorized isolated session override"
              : "existing profile default",
            credentialMetadata: await credentials.list(),
            schemaVersion: settings.schemaVersion,
            settingsSHA256: before,
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      const provider = reference.split("/")[0] ?? "";
      if (provider !== "chatgpt")
        throw Error(
          "Prepared egress supports the existing ChatGPT profile only; alternative requires explicit model choice and provider scope",
        );
      const gateway = createPiAiGateway({
        settings: () => settings,
        credentials,
        subscriptionCredentials: subscriptionStore(credentials),
        scrub: (text) => credentials?.scrub(text) ?? text,
        knownSecrets: () => credentials?.knownSecrets() ?? [],
        now: () => Date.now(),
      });
      stage = "live configured provider model catalog";
      const catalog = await gateway.models(provider, AbortSignal.timeout(45000));
      const available = catalog.models.map((model) => model.reference);
      await writeFile(
        join(output, "model-metadata.json"),
        JSON.stringify(
          {
            configuredReference: settings.defaultModel,
            selectedReference: reference,
            credentialMetadata: await credentials.list(),
            availableReferences: available,
            catalogUTC: new Date().toISOString(),
            platform: process.platform,
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      if (!available.includes(reference))
        throw Error(
          `Configured model ${reference} is absent from live provider catalog; explicit user model selection required`,
        );
      stage = "configured model availability";
      await gateway.prepareModel?.(reference, AbortSignal.timeout(45000));
      const selectedCases = argument("cases")?.split(",");
      if (selectedCases?.some((id) => !cases.some((item) => item.id === id)))
        throw Error("Unknown selected rubric case");
      for (const item of cases.filter((item) => !selectedCases || selectedCases.includes(item.id))) {
        stage = `real-model case ${item.id}`;
        console.log(`Running real model case ${item.id} using ${reference}`);
        await runCase({
          folder: join(output, item.id),
          id: item.id,
          gateway,
          model: reference,
          worker: new URL(worker),
          scrub: (text) => credentials?.scrub(text) ?? text,
        });
      }
      exit = 0;
    } catch (error) {
      const safe = credentials?.sanitize(
        error instanceof Error ? { name: error.name, message: error.message } : error,
      ) ?? { code: "PROFILE_UNAVAILABLE" };
      await writeFile(
        join(output, "blocker.json"),
        JSON.stringify(
          {
            observedUTC: new Date().toISOString(),
            stage,
            error: safe,
            semanticAcceptance: "not complete; no fabricated model/version/artifact verdicts",
            next: "Use normal VERA to refresh existing login if required, or explicitly choose an available model; then prepare a fresh owned output and rerun. Do not modify settings in this harness.",
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      console.log("Real-model acceptance blocked; see blocker.json and safe model metadata if available.");
    } finally {
      app.setPath("userData", join(output, "electron-profile"));
      await writeFile(join(output, "egress.json"), JSON.stringify(requests, null, 2), { flag: "wx" });
      await writeFile(
        join(output, "profile-integrity.json"),
        JSON.stringify(
          {
            settingsSHA256Before: before,
            settingsSHA256After: sha256(await readFile(settingsPath)),
            settingsUnchanged: before === sha256(await readFile(settingsPath)),
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      await credentials?.close();
      app.exit(exit);
    }
  })
  .catch(() => {
    app.exit(2);
  });
