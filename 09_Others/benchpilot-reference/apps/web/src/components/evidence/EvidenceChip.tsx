import { evidenceLabel, parseEvidenceRef, type EvidenceKind } from "@benchpilot/shared";
import { Activity, FileText, ListChecks, Network, ScrollText, TriangleAlert, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEvidenceOpener } from "./EvidenceContext";

export const EVIDENCE_ICON: Record<EvidenceKind, LucideIcon> = {
  pcap: Network,
  log: ScrollText,
  metric: Activity,
  check: ListChecks,
  doc: FileText,
};

const CHIP =
  "mx-px inline-flex h-[22px] max-w-full items-center gap-1 rounded-[5px] border px-1.5 align-middle font-mono text-[11.5px] leading-none font-medium whitespace-nowrap";

/** Clickable citation (05 §6). Invalid refs render amber and don't open. */
export function EvidenceChip({ evidenceRef, valid = true, className }: { evidenceRef: string; valid?: boolean; className?: string }) {
  const { open } = useEvidenceOpener();
  const parsed = parseEvidenceRef(evidenceRef);
  const label = evidenceLabel(evidenceRef);

  if (!valid || !parsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className={cn(CHIP, "border-warn/50 bg-warn-soft text-warn", className)} aria-label={`${label}: citation could not be verified`}>
            <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>Citation could not be verified</TooltipContent>
      </Tooltip>
    );
  }

  const Icon = EVIDENCE_ICON[parsed.kind];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => open(evidenceRef)}
          className={cn(CHIP, "border-border-strong bg-card text-foreground transition-colors hover:border-primary hover:text-primary", className)}
        >
          <Icon className="size-3 shrink-0 text-faint-foreground" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="font-mono">{evidenceRef}</TooltipContent>
    </Tooltip>
  );
}
