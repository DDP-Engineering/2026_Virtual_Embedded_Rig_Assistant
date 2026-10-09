import type { TestbenchConfig } from "@benchpilot/shared";
import { BookOpen, GitCompareArrows, Gauge, Hourglass, ListChecks, Microscope, Network, Presentation, Sparkles, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useSkill, useSkills } from "@/api/queries";
import { EmptyState } from "@/components/common/Bits";
import { Markdown } from "@/components/common/Markdown";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Box, toggle, useConfigList, type ListControl } from "./parts";

const SKILL_ICONS: Record<string, LucideIcon> = {
  "test-planner": ListChecks,
  "firmware-comparator": GitCompareArrows,
  "dhcp-ipv6-tester": Network,
  "performance-analyst": Gauge,
  "endurance-tester": Hourglass,
  "failure-analyzer": Microscope,
  "report-presenter": Presentation,
};

/** Skill cards with switches and a SKILL.md drawer (05 §2 Skills). Controlled: `value` = enabled skill names. */
export function SkillsPanel({ value, onChange, disabled }: ListControl) {
  const { data: skills, isPending, error } = useSkills();
  const [open, setOpen] = useState<string | null>(null);

  if (isPending)
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-[10px]" />
        ))}
      </div>
    );
  if (error) return <EmptyState>Could not load skills: {error.message}</EmptyState>;

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
        {skills.map((s) => {
          const Icon = SKILL_ICONS[s.name] ?? Sparkles;
          return (
            <Box key={s.name} className="grid-rows-[1fr_auto]">
              <div className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block truncate font-mono text-[13px] font-medium" title={s.name}>
                    {s.name}
                  </b>
                  <p className="mt-0.5 line-clamp-3 text-[12.5px] text-muted-foreground" title={s.description}>
                    {s.description}
                  </p>
                </div>
                <Switch
                  className="mt-1"
                  checked={value.includes(s.name)}
                  disabled={disabled}
                  onCheckedChange={(c) => onChange(toggle(value, s.name, c))}
                  aria-label={`Enable ${s.name}`}
                />
              </div>
              <Button variant="link" size="sm" className="h-6 justify-self-start px-0" onClick={() => setOpen(s.name)}>
                <BookOpen aria-hidden="true" />
                View SKILL.md
              </Button>
            </Box>
          );
        })}
      </div>
      <SkillDrawer name={open} onClose={() => setOpen(null)} />
    </>
  );
}

export function SkillDrawer({ name, onClose }: { name: string | null; onClose: () => void }) {
  // Keep the last skill while the sheet animates out.
  const [shown, setShown] = useState(name);
  if (name && name !== shown) setShown(name);
  const { data, isPending, error } = useSkill(shown);

  return (
    <Sheet open={!!name} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[640px] gap-0 sm:max-w-[640px]">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="font-mono">{shown}/SKILL.md</SheetTitle>
          <SheetDescription>{data?.description ?? "Loaded on demand with load_skill."}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isPending ? (
            <div className="grid gap-2">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : error ? (
            <EmptyState>Could not load SKILL.md: {error.message}</EmptyState>
          ) : (
            <Markdown>{data.body}</Markdown>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function SkillsTab({ testbenchId, config }: { testbenchId: string; config: TestbenchConfig }) {
  const control = useConfigList(testbenchId, config, "enabled_skills");
  return (
    <div className="grid gap-3">
      <p className="text-[12.5px] text-muted-foreground">
        Skills are instructions the agent loads on demand with <code className="font-mono">load_skill</code>. Disabled skills are hidden from the agent.
      </p>
      <SkillsPanel {...control} />
    </div>
  );
}
