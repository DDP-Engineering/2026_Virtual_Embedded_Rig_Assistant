import type { TestbenchConfig, ToolGroup, ToolMeta } from "@benchpilot/shared";
import { useTools } from "@/api/queries";
import { EmptyState } from "@/components/common/Bits";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Box, toggle, useConfigList, type ListControl } from "./parts";

export const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
  skills: "Skills",
  knowledge: "Knowledge",
  catalog: "Catalog",
  execution: "Execution",
  history: "History",
  logs: "Logs",
  packets: "Packets",
  metrics: "Metrics",
  correlation: "Correlation",
  compare: "Compare",
  reporting: "Reporting",
};

/** `load_skill` is always available and never listed in `enabled_tools`. */
export const ALWAYS_ON_TOOLS = ["load_skill"];

/** Default selection for a new testbench: every toggleable tool. */
export const defaultTools = (tools: ToolMeta[]) => tools.filter((t) => !ALWAYS_ON_TOOLS.includes(t.name)).map((t) => t.name);

export function RequiresApprovalBadge() {
  return <span className="ml-1.5 inline-flex h-[18px] items-center rounded-[4px] border border-current px-[5px] align-[1px] text-[11px] font-medium text-warn">Requires approval</span>;
}

/** Grouped tool switches (05 §2 Tools). Controlled: `value` = enabled tool names. */
export function ToolsPanel({ value, onChange, disabled }: ListControl) {
  const { data: tools, isPending, error } = useTools();
  if (isPending) return <PanelSkeleton />;
  if (error) return <EmptyState>Could not load tools: {error.message}</EmptyState>;

  const groups = (Object.keys(TOOL_GROUP_LABELS) as ToolGroup[])
    .map((g) => ({ group: g, list: tools.filter((t) => t.group === g) }))
    .filter((g) => g.list.length > 0);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] items-start gap-3">
      {groups.map(({ group, list }) => {
        const toggleable = list.filter((t) => !ALWAYS_ON_TOOLS.includes(t.name));
        const on = toggleable.filter((t) => value.includes(t.name)).length;
        return (
          <Box
            key={group}
            title={TOOL_GROUP_LABELS[group]}
            actions={toggleable.length > 0 && <span className="text-xs text-faint-foreground tabular-nums">{on} of {toggleable.length} on</span>}
          >
            <div>
              {list.map((t) => (
                <div key={t.name} className="flex items-start gap-3 border-b py-2.5 last:border-b-0 first:pt-0.5 last:pb-0.5">
                  <div className="min-w-0 flex-1">
                    <b className="font-mono text-[13px] font-medium break-all">{t.name}</b>
                    {t.requiresApproval && <RequiresApprovalBadge />}
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">{t.description}</p>
                  </div>
                  {ALWAYS_ON_TOOLS.includes(t.name) ? (
                    <span className="mt-0.5 shrink-0 rounded-[5px] bg-primary-soft px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-primary">Always on</span>
                  ) : (
                    <Switch
                      className="mt-1"
                      checked={value.includes(t.name)}
                      disabled={disabled}
                      onCheckedChange={(c) => onChange(toggle(value, t.name, c))}
                      aria-label={`Enable ${t.name}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </Box>
        );
      })}
    </div>
  );
}

export function ToolsTab({ testbenchId, config }: { testbenchId: string; config: TestbenchConfig }) {
  const control = useConfigList(testbenchId, config, "enabled_tools");
  return (
    <div className="grid gap-3">
      <p className="text-[12.5px] text-muted-foreground">
        Tools the agent may call on this testbench. Execution tools always stop for your approval; the server enforces it.
      </p>
      <ToolsPanel {...control} />
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-36 rounded-[10px]" />
      ))}
    </div>
  );
}
