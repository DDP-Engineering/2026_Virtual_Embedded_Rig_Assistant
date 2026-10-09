import type { Cluster, ToolGroup, TranscriptItem } from "@benchpilot/shared";
import {
  Activity,
  ChartGantt,
  ChevronRight,
  CircleX,
  GitCompareArrows,
  History,
  ListChecks,
  Network,
  Play,
  Save,
  ScrollText,
  Search,
  Ticket,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useTools } from "@/api/queries";
import { ClusterCard } from "@/components/report/ClusterCard";
import { cn } from "@/lib/utils";

const GROUP_ICON: Record<ToolGroup, LucideIcon> = {
  skills: Zap,
  knowledge: Search,
  catalog: ListChecks,
  execution: Play,
  history: History,
  logs: ScrollText,
  packets: Network,
  metrics: Activity,
  correlation: ChartGantt,
  compare: GitCompareArrows,
  reporting: Save,
};

/** `query: "2.1.0 release notes", limit: 8` — arrays of objects collapse to a count. */
export function shortArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => {
      if (Array.isArray(v) && v.some((x) => typeof x === "object")) return `${k}: ${v.length}`;
      if (typeof v === "string") return `${k}: ${JSON.stringify(v.length > 80 ? `${v.slice(0, 77)}…` : v)}`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join(", ");
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-[13px] shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-primary", className)} aria-hidden="true" />;
}

type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

/** 05 ToolCallRow: icon per group, name, short args, duration; expands to args + result preview. */
export function ToolCallRow({ item }: { item: ToolItem }) {
  const { data: tools } = useTools();
  const group = tools?.find((t) => t.name === item.name)?.group;
  const Icon = item.status === "error" ? CircleX : group ? GROUP_ICON[group] : Search;
  const [open, setOpen] = useState(false);
  const clusters = item.name === "save_report_analysis" && Array.isArray(item.args.clusters) ? (item.args.clusters as Cluster[]) : null;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <div className="min-w-0 rounded-[7px] border bg-card text-[12.5px]">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-full min-w-0 items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left hover:bg-accent/60"
        >
          <Icon className={cn("size-[15px] shrink-0", item.status === "error" ? "text-fail" : "text-faint-foreground")} aria-hidden="true" />
          <span className="font-mono font-medium whitespace-nowrap">{item.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground" title={shortArgs(item.args)}>
            {shortArgs(item.args)}
          </span>
          {item.status === "running" ? (
            <Spinner />
          ) : (
            <span className="text-[11.5px] whitespace-nowrap text-faint-foreground">
              {item.summary}
              {item.durationMs !== undefined && item.durationMs > 0 && ` · ${formatMs(item.durationMs)}`}
            </span>
          )}
          <ChevronRight className={cn("size-3.5 shrink-0 text-faint-foreground transition-transform", open && "rotate-90")} aria-hidden="true" />
        </button>
        {open && (
          <pre className="m-0 max-h-80 overflow-auto border-t bg-code px-3 py-2 font-mono text-[11.5px] leading-[1.55] break-words whitespace-pre-wrap text-muted-foreground">
            {`args ${JSON.stringify(item.args, null, 2)}`}
            {item.preview && `\n\nresult\n${item.preview}`}
          </pre>
        )}
      </div>
      {clusters?.map((c) => <ClusterCard key={c.title} cluster={c} />)}
      {item.name === "draft_ticket" && item.status === "ok" && typeof item.args.title === "string" && (
        <div className="flex min-w-0 items-center gap-2 rounded-[7px] border border-dashed px-2.5 py-1.5 text-[12.5px]">
          <Ticket className="size-[15px] shrink-0 text-faint-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{item.args.title}</span>
          <span className="shrink-0 text-faint-foreground">Draft · not sent</span>
        </div>
      )}
    </div>
  );
}

const formatMs = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

export function SkillBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-[3px] text-xs font-medium text-primary">
      <Zap className="size-[13px]" aria-hidden="true" />
      Skill loaded · {name}
    </span>
  );
}
