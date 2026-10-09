import { markdownSection, type TestbenchConfig, type TestbenchDoc, type Topology } from "@benchpilot/shared";
import { useDocs, useReports, useTools } from "@/api/queries";
import { IdLink, KeyValues } from "@/components/common/Bits";
import { VerdictPill } from "@/components/common/Pills";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShortDate } from "@/lib/format";
import { Box, FirmwareChips } from "./parts";
import { TopologyDiagram } from "./TopologyDiagram";

const plain = (md: string) => md.replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]*)\*\*/g, "$1").trim();

/** "## Hardware" bullets of the device doc (`docs/devices/<model>.md`, or the device doc whose title is the model). */
export function hardwareFromDocs(docs: TestbenchDoc[], model: string): string[] | null {
  const slug = model.toLowerCase();
  const doc =
    docs.find((d) => d.path.toLowerCase() === `docs/devices/${slug}.md`) ??
    docs.find((d) => d.path.startsWith("docs/devices/") && d.title.trim().toLowerCase() === slug);
  const section = doc && markdownSection(doc.content, "hardware");
  if (!section) return null;
  const bullets = section.body
    .split("\n")
    .filter((l) => /^\s*[-*] /.test(l))
    .map((l) => plain(l.replace(/^\s*[-*] /, "")));
  return bullets.length ? bullets : null;
}

/** First line of TESTBENCH.md "## Sources per run" (always-loaded agent instructions, 03). */
export function sourcesFromDocs(docs: TestbenchDoc[]): string | null {
  const pinned = docs.find((d) => d.pinned);
  const section = pinned && markdownSection(pinned.content, "sources-per-run");
  const first = section?.body.trim().split("\n")[0];
  return first ? plain(first.replace(/\.$/, "")) : null;
}

export function OverviewTab({ testbenchId, config, topology }: { testbenchId: string; config: TestbenchConfig; topology: Topology }) {
  const docs = useDocs(testbenchId);
  const tools = useTools();
  const reports = useReports();

  const pinned = docs.data?.filter((d) => d.pinned).length ?? 0;
  const approval = tools.data?.filter((t) => t.requiresApproval && config.enabled_tools.includes(t.name)).length;
  const recent = reports.data?.filter((r) => r.testbenchId === testbenchId).slice(0, 4);
  const hardware = docs.data ? hardwareFromDocs(docs.data, config.device.model) : undefined;
  const sources = docs.data ? sourcesFromDocs(docs.data) : undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1.75fr)_minmax(280px,1fr)] items-start gap-4">
      <Box title="Topology">
        {topology.nodes.length ? (
          <TopologyDiagram topology={topology} />
        ) : (
          <p className="text-[13px] text-muted-foreground">No topology defined. Add nodes and links to docs/topology.yaml.</p>
        )}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <LegendLine label="Wired" />
          <LegendLine label="Wi-Fi / uplink" dashed />
          <LegendLine label="Mirror to probe" mirror />
          <span className="ml-auto">Hover a node for notes</span>
        </p>
      </Box>

      <div className="grid gap-3">
        <Box title="Device under test">
          <KeyValues
            rows={[
              ["Model", `${config.device.model} (fictional)`],
              ["Firmware", <FirmwareChips key="fw" firmware={config.device.firmware} />],
              [
                "Hardware",
                hardware === undefined ? (
                  "…"
                ) : hardware ? (
                  <ul key="hw" className="grid gap-0.5">
                    {hardware.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                ) : (
                  <span key="hw" className="text-muted-foreground">Add a Hardware section to docs/devices/{config.device.model.toLowerCase()}.md</span>
                ),
              ],
            ]}
          />
        </Box>
        <Box title="Configuration">
          <KeyValues
            rows={[
              ["Documents", docs.data ? `${docs.data.length} (${pinned} always loaded)` : "…"],
              ["Tools", `${config.enabled_tools.length} enabled${approval !== undefined ? ` · ${approval} need approval` : ""}`],
              ["Skills", `${config.enabled_skills.length} enabled`],
              ["Tests", `${config.enabled_tests.length} from catalog`],
              ["Sources", sources === undefined ? "…" : (sources ?? "—")],
            ]}
          />
        </Box>
        <Box title="Recent reports">
          {!recent ? (
            <div className="grid gap-2">
              <Skeleton className="h-5" />
              <Skeleton className="h-5" />
            </div>
          ) : recent.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No reports yet. Run a plan from a session.</p>
          ) : (
            <ul className="grid divide-y text-[13px]">
              {recent.map((r) => (
                <li key={r.id} className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                  <IdLink id={r.id} />
                  <span className="font-mono text-xs text-muted-foreground">{r.fw}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatShortDate(r.createdAt)}</span>
                  <VerdictPill state={r.verdict} />
                </li>
              ))}
            </ul>
          )}
        </Box>
      </div>
    </div>
  );
}

function LegendLine({ label, dashed, mirror }: { label: string; dashed?: boolean; mirror?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="22" height="6" aria-hidden="true">
        <line
          x1="0"
          y1="3"
          x2="22"
          y2="3"
          strokeWidth="1.5"
          style={{ stroke: mirror ? "var(--primary)" : "var(--faint-foreground)" }}
          strokeDasharray={mirror ? "2 3" : dashed ? "5 4" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}
