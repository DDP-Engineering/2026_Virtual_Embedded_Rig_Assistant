import type { SessionSummary } from "@benchpilot/shared";
import { Plus } from "lucide-react";
import { Link } from "react-router";
import { useSessions } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShortDate, isToday } from "@/lib/format";
import { cn } from "@/lib/utils";

function subtitle(s: SessionSummary) {
  if (s.status === "running") return `${s.testbenchId} · running`;
  if (s.status === "awaiting_approval") return `${s.testbenchId} · awaiting approval`;
  return [isToday(s.createdAt) ? s.testbenchId : formatShortDate(s.createdAt), s.lastReportId].filter(Boolean).join(" · ");
}

export function SessionList({ activeId, onNew, creating }: { activeId?: string; onNew: () => void; creating: boolean }) {
  const { data, isPending } = useSessions();
  const today = data?.filter((s) => isToday(s.createdAt)) ?? [];
  const earlier = data?.filter((s) => !isToday(s.createdAt)) ?? [];

  const item = (s: SessionSummary) => (
    <Link
      key={s.id}
      to={`/sessions/${s.id}`}
      aria-current={s.id === activeId ? "page" : undefined}
      className={cn("grid grid-cols-[minmax(0,1fr)] gap-px rounded-[7px] px-2.5 py-2 hover:bg-accent", s.id === activeId && "bg-primary-soft hover:bg-primary-soft")}
    >
      <b className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
        {s.status !== "idle" && <span className={cn("size-[7px] shrink-0 rounded-full", s.status === "running" ? "animate-pulse bg-primary" : "bg-warn")} aria-hidden="true" />}
        <span className="min-w-0 truncate" title={s.title}>
          {s.title}
        </span>
      </b>
      <small className="truncate text-[11.5px] text-faint-foreground">{subtitle(s)}</small>
    </Link>
  );

  return (
    <aside aria-label="Sessions" className="flex h-full flex-col gap-1.5 overflow-auto bg-card px-2.5 py-3.5">
      <Button variant="outline" onClick={onNew} disabled={creating}>
        <Plus aria-hidden="true" />
        New session
      </Button>
      {isPending && <Skeleton className="mt-3 h-24" />}
      {today.length > 0 && <p className="px-2 pt-2.5 text-[11px] tracking-wider text-faint-foreground uppercase">Today</p>}
      {today.map(item)}
      {earlier.length > 0 && <p className="px-2 pt-2.5 text-[11px] tracking-wider text-faint-foreground uppercase">Earlier</p>}
      {earlier.map(item)}
    </aside>
  );
}
