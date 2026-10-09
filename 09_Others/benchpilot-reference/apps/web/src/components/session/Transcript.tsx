import { SERVER_RESTART_MESSAGE, type SessionDetail, type TranscriptItem } from "@benchpilot/shared";
import { CircleAlert, RotateCcw, ServerCrash } from "lucide-react";
import { Markdown } from "@/components/common/Markdown";
import { Button } from "@/components/ui/button";
import { ApprovalCard } from "./ApprovalCard";
import { RunCard } from "./RunCard";
import { SkillBadge, ToolCallRow } from "./ToolCallRow";

type Block = { kind: "user"; item: Extract<TranscriptItem, { kind: "user" }> } | { kind: "agent"; key: string; items: TranscriptItem[] };

function toBlocks(items: TranscriptItem[]): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    if (item.kind === "user") blocks.push({ kind: "user", item });
    else {
      const last = blocks.at(-1);
      if (last?.kind === "agent") last.items.push(item);
      else blocks.push({ kind: "agent", key: item.id, items: [item] });
    }
  }
  return blocks;
}

interface TranscriptProps {
  detail: SessionDetail;
  firmware: string[];
  onFocusMonitor: () => void;
  onRetry: () => void;
}

/** The conversation (05 §4 message blocks). */
export function Transcript({ detail, firmware, onFocusMonitor, onRetry }: TranscriptProps) {
  const blocks = toBlocks(detail.items);
  const lastErrorId = [...detail.items].reverse().find((i) => i.kind === "error")?.id;
  const running = !!detail.activeTurnId;

  return (
    <div className="flex min-w-0 flex-col gap-[18px] [&>*]:min-w-0">
      {blocks.map((b) =>
        b.kind === "user" ? (
          <div key={b.item.id} className="max-w-[80%] self-end rounded-[12px_12px_3px_12px] border bg-muted px-3.5 py-[9px] whitespace-pre-wrap">
            {b.item.text}
          </div>
        ) : (
          <div key={b.key} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2.5">
            <div className="grid size-7 place-items-center rounded-lg bg-primary text-[11px] font-semibold text-primary-foreground" aria-hidden="true">
              BP
            </div>
            <div className="flex min-w-0 flex-col gap-2 [&>*]:min-w-0">
              <div className="text-[13px] leading-7 font-semibold">BenchPilot</div>
              {b.items.map((item) => (
                <ItemView key={`${item.kind}-${item.id}`} item={item} detail={detail} firmware={firmware} onFocusMonitor={onFocusMonitor} onRetry={item.id === lastErrorId && !running ? onRetry : undefined} />
              ))}
            </div>
          </div>
        ),
      )}
      {running && blocks.at(-1)?.kind === "user" && (
        <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-2.5 text-[13px] text-muted-foreground">
          <div className="grid size-7 place-items-center rounded-lg bg-primary text-[11px] font-semibold text-primary-foreground" aria-hidden="true">
            BP
          </div>
          <span className="inline-flex items-center gap-1">
            Thinking
            <span className="animate-pulse">…</span>
          </span>
        </div>
      )}
    </div>
  );
}

function ItemView({ item, detail, firmware, onFocusMonitor, onRetry }: { item: TranscriptItem; detail: SessionDetail; firmware: string[]; onFocusMonitor: () => void; onRetry?: () => void }) {
  switch (item.kind) {
    case "assistant":
      return (
        <div className="min-w-0">
          <Markdown citations={item.citations}>{item.text}</Markdown>
          {item.streaming && <span className="ml-0.5 inline-block h-4 w-[7px] translate-y-0.5 animate-pulse bg-primary align-baseline" aria-label="Streaming" />}
        </div>
      );
    case "tool":
      // load_skill is shown as the SkillBadge.
      return item.name === "load_skill" && item.status !== "error" ? null : <ToolCallRow item={item} />;
    case "skill":
      return <SkillBadge name={item.name} />;
    case "plan":
      return <ApprovalCard key={item.plan.status} plan={item.plan} firmware={firmware} />;
    case "run": {
      const run = detail.runs[item.reportId];
      return run ? <RunCard run={run} onFocus={onFocusMonitor} /> : null;
    }
    case "error":
      // P3 restart recovery: not a model failure — the turn was cut off and a pending plan was cancelled.
      if (item.message === SERVER_RESTART_MESSAGE)
        return (
          <div role="alert" className="flex flex-wrap items-center gap-2.5 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-warn">
            <ServerCrash className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <b className="font-medium">The server restarted during this turn.</b>{" "}
              <span className="text-muted-foreground">Unfinished work was stopped and a plan still awaiting approval was cancelled. Ask again to continue.</span>
            </span>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RotateCcw aria-hidden="true" />
                Ask again
              </Button>
            )}
          </div>
        );
      return (
        <div role="alert" className="flex flex-wrap items-center gap-2.5 rounded-lg border border-fail/40 bg-fail-soft px-3 py-2 text-[13px] text-fail">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{item.message}</span>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw aria-hidden="true" />
              Retry
            </Button>
          )}
        </div>
      );
    case "user":
      return null;
  }
}
