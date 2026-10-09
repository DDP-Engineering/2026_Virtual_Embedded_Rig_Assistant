// `npm run bench -- chat [--script <fixture>]` (06 P3 step 7): the agent in the terminal, on the runtime DB.
// --script: replay provider forced to that fixture, sends its prompt, auto-approves plans (headless DONE-WHEN).
// Interactive: the active provider from Settings; plans are approved or rejected at the prompt.
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import type { SessionEvent, StopReason } from "@benchpilot/shared";
import { config, type Config } from "../config.ts";
import { createServerContext, type ServerContext } from "../context.ts";
import type { ModelRef } from "../llm/gateway.ts";
import { consoleEmitter, type RunEvent } from "../runner/emitter.ts";

const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

/** Prints session events; returns the unsubscribe function. */
function printer(ctx: ServerContext, sessionId: string, onPlan: (planId: string) => void): () => void {
  const runs = consoleEmitter();
  let open = false;
  const nl = () => {
    if (open) process.stdout.write("\n");
    open = false;
  };
  return ctx.hub.subscribe(sessionId, (_seq, e: SessionEvent) => {
    switch (e.type) {
      case "message.delta":
        process.stdout.write(e.text);
        open = true;
        break;
      case "message.done": {
        nl();
        const bad = e.citations.filter((c) => !c.valid);
        if (e.citations.length) console.log(dim(`  citations: ${e.citations.length - bad.length}/${e.citations.length} valid${bad.length ? ` · invalid: ${bad.map((c) => c.ref).join(", ")}` : ""}`));
        break;
      }
      case "tool.started":
        nl();
        console.log(dim(`  → ${e.name} ${JSON.stringify(e.args).slice(0, 160)}`));
        break;
      case "tool.done":
        console.log(dim(`  ${e.ok ? "✓" : "✗"} ${e.summary} (${e.durationMs} ms)`));
        break;
      case "skill.loaded":
        console.log(dim(`  ⚡ skill ${e.name}`));
        break;
      case "plan.proposed":
        nl();
        console.log(`\n▣ Plan ${e.planId}: ${e.title ?? ""} · ${e.device ?? ""} fw ${e.fw ?? ""}`);
        for (const i of e.items) console.log(`    ${i.testId} v${i.version} ${i.name} — ${i.rationale}`);
        console.log(`    ${e.rationale}`);
        onPlan(e.planId);
        break;
      case "plan.decided":
        console.log(`▣ Plan ${e.planId}: ${e.decision}${e.fw ? ` · fw ${e.fw}` : ""}${e.comment ? ` · “${e.comment}”` : ""}`);
        break;
      case "error":
        nl();
        console.error(`✗ ${e.message}`);
        break;
      case "turn.done":
        nl();
        console.log(dim(`  turn ${e.turnId}: ${e.stopReason}`));
        break;
      default:
        if (e.type.startsWith("run.")) {
          nl();
          runs.emit(e as RunEvent);
        }
    }
  });
}

export async function chat(argv: string[], cfg: Config = config): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { script: { type: "string" }, testbench: { type: "string", default: "TB-01" }, speed: { type: "string" } },
  });
  const run = { ...cfg, ...(values.speed !== undefined ? { demoSpeed: Number(values.speed) } : {}) };
  const ctx = createServerContext(run);
  ctx.agent.recoverInterrupted();
  try {
    const session = ctx.agent.create(values.testbench!);
    console.log(dim(`session ${session.id} on ${session.testbenchId}`));

    if (values.script) {
      const scenario = ctx.replay.scenarios().find((s) => s.name === values.script);
      if (!scenario) throw new Error(`no replay fixture '${values.script}' (have: ${ctx.replay.scenarios().map((s) => s.name).join(", ")})`);
      if (!scenario.prompt) throw new Error(`fixture ${scenario.name} has no "prompt" on its first line`);
      const model: ModelRef = { provider: "replay", model: scenario.name };
      // --script is the only mode that approves on its own (06 P3 step 7).
      const unsub = printer(ctx, session.id, (planId) => setImmediate(() => ctx.agent.decidePlan(planId, { decision: "approve" })));
      console.log(`\n> ${scenario.prompt}\n`);
      ctx.agent.postMessage(session.id, scenario.prompt, { model });
      const stop = await ctx.agent.waitIdle(session.id);
      unsub();
      const d = ctx.agent.detail(session.id);
      const report = d.session.lastReportId;
      if (report) {
        const r = d.runs[report];
        console.log(`\nreport ${report}: ${r?.summary ? `${r.summary.passed} passed, ${r.summary.failed} failed, ${r.summary.errored} error(s)` : "?"} · ${r?.tests.map((t) => `${t.testId}:${t.verdict?.toUpperCase()}`).join(" ")}`);
      }
      return stop === "end" ? 0 : 1;
    }

    const model = ctx.agent.activeModel();
    if (!model) throw new Error("no model connected: set one in Settings (or `PUT /api/settings/llm`), or use --script <fixture>");
    console.log(dim(`model ${model.provider} · ${model.model} · type /exit to quit`));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let pending: string | null = null;
    const unsub = printer(ctx, session.id, (planId) => (pending = planId));
    try {
      for (;;) {
        const text = (await rl.question("\n> ")).trim();
        if (!text) continue;
        if (text === "/exit" || text === "/quit") break;
        ctx.agent.postMessage(session.id, text);
        let stop: StopReason | null = null;
        const done = ctx.agent.waitIdle(session.id).then((s) => (stop = s));
        while (stop === null) {
          await Promise.race([done, new Promise((r) => setTimeout(r, 100))]);
          if (pending) {
            const planId: string = pending;
            pending = null;
            const answer = (await rl.question("Approve this plan? [y]es / [n]o (optionally followed by a comment): ")).trim();
            const yes = /^y(es)?\b/i.test(answer);
            const comment = answer.replace(/^(y(es)?|n(o)?)\b\s*/i, "") || undefined;
            ctx.agent.decidePlan(planId, { decision: yes ? "approve" : "reject", ...(comment ? { comment } : {}) });
          }
        }
      }
    } finally {
      unsub();
      rl.close();
    }
    return 0;
  } finally {
    await ctx.agent.stopAll();
    ctx.db.close();
  }
}
