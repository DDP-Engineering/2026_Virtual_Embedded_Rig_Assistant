import type { SessionDetail } from "@benchpilot/shared";
import { useDocs, useSkills, useTestbench } from "@/api/queries";
import { SectionTitle } from "@/components/common/Bits";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", custom: "Custom endpoint", chatgpt: "ChatGPT", replay: "Demo replay" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2.5 border-b border-dashed py-[5px] text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

/** 05 Context: what the agent can see, in the style of Claude Code. */
export function ContextTab({ detail }: { detail: SessionDetail }) {
  const tbId = detail.session.testbenchId;
  const { data: tb } = useTestbench(tbId);
  const { data: docs } = useDocs(tbId);
  const { data: skills } = useSkills();
  const config = tb?.config;
  const enabledSkills = (skills ?? []).filter((s) => config?.enabled_skills.includes(s.name));

  return (
    <div className="grid gap-3.5">
      <SectionTitle>What the agent can see</SectionTitle>
      <div>
        <Row label="Testbench">
          <span className="font-mono">{tbId}</span> {config?.name}
        </Row>
        <Row label="Instructions">
          <span className="font-mono">TESTBENCH.md</span> <span className="text-faint-foreground">always loaded</span>
        </Row>
        <Row label="Searchable docs">{docs ? `${docs.filter((d) => !d.pinned).length} files` : "…"}</Row>
        <Row label="Test catalog">{config ? `${config.enabled_tests.length} tests` : "…"}</Row>
        <Row label="Model">{detail.session.provider ? `${PROVIDER_LABEL[detail.session.provider]} · ${detail.session.model}` : "not set"}</Row>
        <Row label="Tool calls this session">
          <span className="tabular-nums">{detail.toolCalls}</span>
        </Row>
      </div>

      <SectionTitle>Skills · loaded this session are highlighted</SectionTitle>
      <div className="flex flex-wrap gap-1">
        {enabledSkills.map((s) => {
          const loaded = detail.loadedSkills.includes(s.name);
          return (
            <span key={s.name} title={s.description} className={cn("rounded px-1.5 py-0.5 font-mono text-[11.5px]", loaded ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground")}>
              {s.name}
            </span>
          );
        })}
      </div>

      <SectionTitle>Enabled tools ({config?.enabled_tools.length ?? 0} + load_skill)</SectionTitle>
      <div className="flex flex-wrap gap-1">
        {config?.enabled_tools.map((t) => (
          <span key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground">
            {t}
          </span>
        ))}
      </div>

      {detail.turns.length > 0 && (
        <>
          <SectionTitle>Steps per turn</SectionTitle>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-muted text-left text-xs text-muted-foreground">
                  <th className="px-2.5 py-1.5 font-medium">Turn</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Tool calls</th>
                  <th className="px-2.5 py-1.5 font-medium">Ended</th>
                </tr>
              </thead>
              <tbody>
                {detail.turns.map((t, i) => (
                  <tr key={t.turnId} className="border-t">
                    <td className="px-2.5 py-1.5 tabular-nums">{i + 1}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{t.steps}</td>
                    <td className="px-2.5 py-1.5 text-muted-foreground">{t.stopReason ?? "running"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-[12.5px] text-muted-foreground">
        Execution tools (<code className="rounded bg-muted px-1 font-mono text-[0.9em]">propose_test_plan</code>,{" "}
        <code className="rounded bg-muted px-1 font-mono text-[0.9em]">run_test_plan</code>) need your approval. The server enforces this, not the prompt.
      </p>
    </div>
  );
}
