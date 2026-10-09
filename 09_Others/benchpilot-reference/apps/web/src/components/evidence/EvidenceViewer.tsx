import type { EvidenceResponse, PacketTreeNode } from "@benchpilot/shared";
import { ChevronRight, Download, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useEvidence } from "@/api/queries";
import { MetricChart } from "@/components/charts/MetricChart";
import { CopyButton, SectionTitle } from "@/components/common/Bits";
import { Markdown } from "@/components/common/Markdown";
import { VerdictPill } from "@/components/common/Pills";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { metricDisplay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EvidenceChip } from "./EvidenceChip";

const KIND_LABEL: Record<EvidenceResponse["kind"], string> = {
  pcap: "Packet capture",
  log: "Log",
  metric: "Metric",
  check: "Check",
  doc: "Document",
};

/** Renders GET /evidence?ref= (05 §6). Used by the drawer and the session's Evidence tab. */
export function EvidenceViewer({ evidenceRef }: { evidenceRef: string }) {
  const { data, isPending, isError } = useEvidence(evidenceRef);

  if (isPending)
    return (
      <div className="grid gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  if (isError || !data)
    return (
      <div className="grid gap-2 rounded-lg border border-warn/40 bg-warn-soft p-3 text-[13px] text-warn">
        <span className="flex items-center gap-2 font-medium">
          <TriangleAlert className="size-4" aria-hidden="true" />
          Citation could not be verified
        </span>
        <span className="font-mono text-[11.5px] break-all">{evidenceRef}</span>
      </div>
    );

  return (
    <div className="grid min-w-0 gap-3.5">
      <div className="grid gap-1">
        <SectionTitle>{KIND_LABEL[data.kind]}</SectionTitle>
        <h3 className="text-sm font-semibold text-balance">{data.title}</h3>
        <span className="font-mono text-[11.5px] break-all text-muted-foreground">{data.ref}</span>
      </div>
      <EvidenceBody data={data} />
    </div>
  );
}

function EvidenceBody({ data }: { data: EvidenceResponse }) {
  switch (data.kind) {
    case "pcap":
      return (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full border-collapse font-mono text-[11px] leading-snug">
              <thead>
                <tr className="bg-muted text-left font-sans text-xs text-muted-foreground">
                  {["No.", "Time", "Source", "Destination", "Protocol", "Length", "Info"].map((h, i) => (
                    <th key={h} className={cn("border-b px-2 py-1.5 font-medium whitespace-nowrap", (i === 0 || i === 1 || i === 5) && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.no} className={cn("border-b last:border-b-0", r.no === data.frame && "bg-highlight text-highlight-foreground")} aria-current={r.no === data.frame || undefined}>
                    <td className="px-2 py-1 text-right tabular-nums">{r.no}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.time}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.src}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.dst}</td>
                    <td className="px-2 py-1">{r.proto}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.length}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.info}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-lg border bg-code px-2 py-2 font-mono text-[11.5px] leading-[1.65]" role="tree" aria-label={`Frame ${data.frame} details`}>
            {data.detail.map((n, i) => (
              <TreeNode key={i} node={n} depth={0} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Open in Wireshark with</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px] break-all text-foreground">{data.filter}</code>
            <CopyButton value={data.filter} label="Copy filter" toastText="Filter copied" />
            <Button variant="outline" size="sm" asChild>
              <a href={data.downloadUrl} download title={`Download ${data.capture}.pcapng of ${data.testRunId}`}>
                <Download aria-hidden="true" />
                pcapng
              </a>
            </Button>
          </div>
        </>
      );

    case "log":
      return (
        <div className="overflow-x-auto rounded-lg border bg-code py-1 font-mono text-[11.5px] leading-[1.65]">
          <div className="min-w-max">
            {data.lines.map((l) => (
              <div
                key={l.no}
                className={cn("grid grid-cols-[42px_max-content] gap-2.5 px-2.5 whitespace-pre", l.no === data.target && "bg-highlight text-highlight-foreground")}
                aria-current={l.no === data.target || undefined}
              >
                <span className="text-right text-faint-foreground select-none">{l.no}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case "metric": {
      const d = metricDisplay(data.series.name, data.series.unit);
      const span = data.series.endTs - data.series.startTs;
      return (
        <>
          <div className="grid gap-1 rounded-[9px] border px-3 pt-2.5 pb-1.5">
            <header className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <b className="font-medium">
                {d.label} ({d.unit})
              </b>
              {data.baseline && <span className="text-faint-foreground">dashed: {data.baseline.label}</span>}
            </header>
            <MetricChart
              ariaLabel={`${d.label} over the run with a marker at the cited time`}
              startTs={data.series.startTs}
              span={span}
              divisor={d.div}
              series={[
                ...(data.baseline ? [{ name: "baseline", points: data.baseline.points, dashed: true }] : []),
                { name: data.series.name, points: data.series.points, color: "var(--primary)", fill: true, dots: data.series.name === "dns_response_ms" },
              ]}
              markers={[{ ts: data.markerTs, label: "cited" }, ...data.series.markers.filter((m) => Math.abs(m.ts - data.markerTs) > span / 50)]}
              height={170}
            />
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            min {fmt(data.series.stats.min / d.div)} · max {fmt(data.series.stats.max / d.div)} · avg {fmt(data.series.stats.avg / d.div)} {d.unit}
            {data.series.name === "dns_response_ms" && ` · p95 ${fmt(data.series.stats.p95)} ms`}
          </p>
          {data.note && <p className="text-[12.5px] text-muted-foreground">{data.note}</p>}
        </>
      );
    }

    case "check":
      return (
        <div className="grid gap-2.5 rounded-lg border p-3 text-[13px]">
          <div className="flex items-center gap-2">
            <VerdictPill state={data.check.pass ? "pass" : "fail"} />
            <b className="font-medium">{data.check.title}</b>
            <span className="font-mono text-xs text-muted-foreground">{data.check.id}</span>
          </div>
          <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-y-1">
            <dt className="text-muted-foreground">Measured</dt>
            <dd className="font-medium tabular-nums">{data.check.measured}</dd>
            <dt className="text-muted-foreground">Expected</dt>
            <dd className="tabular-nums">{data.check.expected}</dd>
          </dl>
          {data.check.evidence.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <SectionTitle className="mr-1">Evidence</SectionTitle>
              {data.check.evidence.map((e) => (
                <EvidenceChip key={e} evidenceRef={e} />
              ))}
            </div>
          )}
        </div>
      );

    case "doc":
      return (
        <div className="grid gap-2 rounded-lg border p-3.5">
          {data.heading && data.highlight !== undefined ? (
            <>
              <h4 className="text-[13.5px] font-semibold">{data.heading}</h4>
              <div className="rounded-[3px] bg-highlight px-1.5 py-1 text-highlight-foreground">
                <Markdown className="text-[13px]">{data.highlight}</Markdown>
              </div>
            </>
          ) : (
            <Markdown className="text-[13px]">{data.markdown}</Markdown>
          )}
        </div>
      );
  }
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

function TreeNode({ node, depth }: { node: PacketTreeNode; depth: number }) {
  const hasChildren = !!node.children?.length;
  const [open, setOpen] = useState(true);
  return (
    <div role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={node.highlight || undefined}>
      <div className="flex items-start whitespace-pre" style={{ paddingLeft: depth * 16 }}>
        {hasChildren ? (
          <button type="button" onClick={() => setOpen(!open)} className="mt-[3px] mr-0.5 grid size-3.5 shrink-0 place-items-center text-faint-foreground hover:text-foreground" aria-label={open ? "Collapse" : "Expand"}>
            <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} aria-hidden="true" />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className={cn(node.highlight && "rounded-sm bg-highlight px-0.5 text-highlight-foreground")}>{node.label}</span>
      </div>
      {hasChildren && open && node.children!.map((c, i) => <TreeNode key={i} node={c} depth={depth + 1} />)}
    </div>
  );
}
