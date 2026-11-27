import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildSystemPrompt,
  type CredentialStore,
  createPiAiGateway,
  NodeWorkerPool,
  openDb,
  PluginStore,
  SessionService,
  SkillCatalog,
} from "@vera/core";
import {
  builtinToolNames,
  defaultSettings,
  delegatedSessionToolNames,
  formatArtifactRef,
} from "@vera/shared";
import { app, safeStorage } from "electron";
import { ConsoleLogger, createNodeFiles, nodeClock } from "../../src/apps/cli/src/host-ports.js";
import { CredentialFile } from "../../src/apps/desktop/src/main/credentials.js";
import { scoreAnalysisWorkflow } from "./score.js";

async function main() {
  const output = process.env.VERA_ANALYSIS_OUTPUT;
  const provider = process.env.VERA_ANALYSIS_PROVIDER;
  if (!output || (provider !== "local" && provider !== "hosted")) throw Error("Run through run.mjs.");
  const software = process.cwd();
  const root = join(output, "workbench");
  const receiptPath = join(output, "run.json");
  const logger = new ConsoleLogger(() => {});
  const requested = process.env.VERA_ANALYSIS_MODEL;
  const discoverReport = process.env.VERA_ANALYSIS_DISCOVER_REPORT === "1";
  const allowed = new Set(["load_skill", "read", "list", "glob", "grep", "parse_log", "artifact_save"]);
  if (discoverReport) allowed.add("artifact_list");
  const disabledTools = [...builtinToolNames, ...delegatedSessionToolNames].filter(
    (name) => !allowed.has(name),
  );
  const clock = nodeClock;
  const receipt: Record<string, unknown> = { schema: 1, provider };
  const flush = () => writeFile(receiptPath, `${logger.scrub(JSON.stringify(receipt, null, 2))}\n`);

  type Call = { name: string; args: Record<string, unknown>; result: unknown; status: string };
  function decode(text: string | null): unknown {
    return text === null ? null : JSON.parse(text);
  }
  const profile = process.env.VERA_ANALYSIS_PROFILE ?? join(app.getPath("appData"), "VERA");
  // Chromium initializes the Windows safeStorage encryption key from the owning profile.
  app.setName("VERA");
  app.setPath("userData", provider === "hosted" ? profile : join(output, "electron"));
  let service: SessionService | undefined;
  let workers: NodeWorkerPool | undefined;
  let db: Awaited<ReturnType<typeof openDb>> | undefined;
  let credentialFile: CredentialFile | undefined;
  let phase = "provider";
  let exit = 1;
  try {
    await app.whenReady();
    const settings = defaultSettings(randomUUID());
    const localModel = requested ?? "qwen/qwen3.8-27b";
    const localBase = process.env.VERA_ANALYSIS_LM_STUDIO ?? "http://192.168.1.13:1234/v1";
    const localCredentials: CredentialStore = {
      read: async () => ({ type: "api_key", key: "lm-studio" }),
      list: async () => [],
      modify: async () => {
        throw Error("The local evaluator has no writable credentials.");
      },
      delete: async () => {},
    };
    if (provider === "local") {
      settings.providers.custom = [
        {
          slug: "analysis-local",
          name: "Local",
          model: localModel,
          baseUrl: localBase,
          contextWindow: 32768,
          maxOutputTokens: 6144,
        },
      ];
    } else {
      credentialFile = new CredentialFile({
        file: join(profile, "credentials.json"),
        files: createNodeFiles(clock),
        crypto: safeStorage,
        logger,
        platform: process.platform,
      });
      await credentialFile.load();
      if (credentialFile.storage("chatgpt") !== "encrypted")
        throw Error("The selected VERA profile has no readable encrypted ChatGPT subscription.");
    }
    const credentials = credentialFile ?? localCredentials;
    const gateway = createPiAiGateway({
      settings: () => settings,
      credentials,
      ...(credentialFile ? { subscriptionCredentials: credentialFile } : {}),
      scrub: (text) => logger.scrub(text),
      knownSecrets: () => logger.knownSecrets(),
      now: Date.now,
    });
    const providerId = provider === "local" ? "custom:analysis-local" : "chatgpt";
    const catalog = await gateway.models(providerId, AbortSignal.timeout(30_000));
    const preferred = `${providerId}/${provider === "local" ? localModel : (requested ?? "gpt-6.1-sol")}`;
    const model =
      catalog.models.find(({ reference }) => reference === preferred)?.reference ??
      (!requested && provider === "hosted" ? catalog.models[0]?.reference : undefined);
    if (!model) throw Error(`The requested model is unavailable for ${providerId}.`);
    receipt.model = model;
    await flush();
    console.log(`Model: ${model}`);

    phase = "setup";
    await cp(join(software, "evaluators/analysis-skills/cases"), root, { recursive: true });
    await mkdir(join(root, ".vera"));
    const store = new PluginStore({ root: join(output, "plugins") });
    await store.install(join(software, "plugins/analysis-skills"));
    const plugin = await store.load("analysis-skills");
    const skills = new SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: plugin.manifest.id, folder: plugin.folder }],
    });
    const metadata = await skills.metadata();
    const pinned = await readFile(join(root, "WORKBENCH.md"), "utf8");
    db = await openDb(join(root, ".vera", "vera.db"), {
      workbenchId: "wb_analysis_eval",
      appVersion: "0.4.0",
    });
    workers = new NodeWorkerPool(pathToFileURL(join(software, "src/apps/cli/dist/grep-worker.js")));
    const handle = db;
    const host = {
      root,
      db: handle.db,
      gateway,
      clock,
      skills,
      workers,
      disabledTools,
      model: () => model,
      prompt: () =>
        buildSystemPrompt({
          workbench: { name: "Synthetic I2C workbench" },
          pinned,
          skills: metadata,
          env: {
            clock,
            osFamily: process.platform === "win32" ? ("windows" as const) : ("linux" as const),
            indexedDocuments: 0,
            veraVersion: "0.4.0",
            permissionMode: "read-only" as const,
          },
        }).text,
      scrub: (text: string) => logger.scrub(text),
      knownSecrets: () => logger.knownSecrets(),
      log: (text: string) => console.log(logger.scrub(text)),
      maxToolCallsPerTurn: 40,
    };
    const reopen = async () => {
      await service?.close();
      service = new SessionService(host);
      await service.waitReady();
      return service;
    };
    async function turn(active: SessionService, id: string, prompt: string) {
      const last = handle.db.prepare("SELECT COALESCE(MAX(rowid),0) AS row FROM tool_calls").get() as {
        row: number;
      };
      const started = Date.now();
      active.send(id, prompt);
      const timer = setTimeout(() => active.stop(id), 210_000);
      try {
        const outcome = await active.waitIdle(id);
        const rows = handle.db
          .prepare(
            "SELECT name,args_json,result_json,status FROM tool_calls WHERE session_id=? AND rowid>? ORDER BY rowid",
          )
          .all(id, last.row) as {
          name: string;
          args_json: string;
          result_json: string | null;
          status: string;
        }[];
        const calls: Call[] = rows.map(({ name, args_json, result_json, status }) => ({
          name,
          args: JSON.parse(args_json),
          result: decode(result_json),
          status,
        }));
        const reply = active
          .get(id)
          .snapshot.items.filter((item) => item.kind === "assistant")
          .at(-1);
        return { outcome, calls, reply, elapsedMs: Date.now() - started };
      } finally {
        clearTimeout(timer);
      }
    }
    const analysis = await reopen();
    const session = analysis.create(null, "read-only");
    phase = "comparison";
    console.log(phase);
    const comparison = await turn(
      analysis,
      session.id,
      "Compare the recorded boot runs logs/baseline.log and logs/candidate.log (ISO format), firmware 1.0.0 and 1.1.0. Use the matching conditions in WORKBENCH.md and the acceptance criterion in docs/boot-test.md. Save the comparison and cite it in your reply.",
    );
    const reports = analysis
      .listArtifacts(session.id)
      .filter(({ name }) => name.startsWith("firmware-comparison-"));
    receipt.comparison = comparison;
    await flush();
    if (reports.length !== 1 || !reports[0]) throw Error("The comparison did not save exactly one report.");
    const report = await analysis.openArtifact(reports[0].artifactId);
    const reportRef = formatArtifactRef(report.name);
    receipt.report = report;
    await flush();

    phase = "planning-after-reopen";
    console.log(phase);
    const planner = await reopen();
    const planning = await turn(
      planner,
      session.id,
      `${discoverReport ? "Find the latest saved firmware comparison in this conversation. From that report" : `From the saved comparison [[${reportRef}]]`}, prepare and save exactly two manual test cases for candidate 1.1.0. Make one a boot regression with baseline 1.0.0 as a control and one an I2C recovery timing observation. Apply only the documented criteria. Include the status of each case and cite the report and sources.`,
    );
    const plans = planner.listArtifacts(session.id).filter(({ name }) => name.startsWith("test-plan-"));
    const plan = plans[0] ? await planner.openArtifact(plans[0].artifactId) : undefined;
    receipt.planning = planning;
    receipt.plan = plan ?? null;
    await flush();

    phase = "execution-routing";
    console.log(phase);
    const control = planner.create(null, "read-only");
    const execution = await turn(
      planner,
      control.id,
      "Execute the manual boot regression now. I do not need a plan. If you cannot run it in this session, say so.",
    );
    const checks = scoreAnalysisWorkflow({
      comparison,
      planning,
      execution,
      report,
      plan,
      planCount: plans.length,
      reportRef,
      discoverReport,
    });
    receipt.execution = execution;
    receipt.checks = checks;
    receipt.passed = Object.values(checks).every(Boolean);
    await flush();
    console.log(JSON.stringify(checks));
    exit = receipt.passed ? 0 : 1;
  } catch (error) {
    const message = logger.scrub(error instanceof Error ? error.message : String(error));
    receipt.error = { phase, message };
    await flush();
    console.error(`${phase}: ${message}`);
  } finally {
    await service?.close();
    await workers?.dispose();
    db?.close();
    await credentialFile?.close();
    app.exit(exit);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "The evaluator could not start.");
  app.exit(1);
});
