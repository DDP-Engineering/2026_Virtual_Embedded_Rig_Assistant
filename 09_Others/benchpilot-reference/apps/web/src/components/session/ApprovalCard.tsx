import type { PlanCardState } from "@benchpilot/shared";
import { Check, CircleAlert, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useDecidePlan } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 05 ApprovalCard: per-item checkbox and rationale, firmware select, Approve & run / Reject with comment. */
export function ApprovalCard({ plan, firmware }: { plan: PlanCardState; firmware: string[] }) {
  const pending = plan.status === "pending";
  const [selected, setSelected] = useState<Set<string>>(() => new Set(plan.items.map((i) => i.testId)));
  const [fw, setFw] = useState(plan.fw);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const decide = useDecidePlan();

  const shownSelected = pending ? selected : new Set((plan.approvedItems ?? []).map((i) => i.testId));
  const chosen = plan.items.filter((i) => selected.has(i.testId));
  const est = (pending ? chosen : (plan.approvedItems ?? plan.items)).reduce((a, i) => ({ demo: a.demo + i.duration.demo_s, sim: a.sim + i.duration.sim_s }), { demo: 0, sim: 0 });
  const edited = chosen.length !== plan.items.length || fw !== plan.fw;
  const fwOptions = [...new Set([...firmware, plan.fw])].sort().reverse();

  const approve = () => {
    if (!chosen.length) {
      toast.error("Select at least one test to run.");
      return;
    }
    // P3: an edit is `{testId, rationale}` per kept item + `fw`; the server re-enriches and validates it (400 → shown below).
    decide.mutate({
      planId: plan.planId,
      decision: "approve",
      items: edited ? chosen.map(({ testId, rationale }) => ({ testId, rationale })) : undefined,
      fw: fw !== plan.fw ? fw : undefined,
    });
  };
  const reject = () => decide.mutate({ planId: plan.planId, decision: "reject", comment: comment.trim() || undefined });

  return (
    <section
      aria-label={`Test plan ${plan.planId}`}
      className={cn("rounded-[10px] border bg-card shadow-[0_1px_2px_rgba(20,32,34,.06)] dark:shadow-none", pending && "border-primary")}
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b px-3.5 py-2.5">
        <h3 className="text-sm font-semibold">{plan.title || "Test plan"}</h3>
        <span className="font-mono text-faint-foreground">{plan.planId}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium before:size-[7px] before:rounded-full before:bg-current",
            pending ? "text-primary" : plan.status === "approved" ? "text-pass" : plan.status === "rejected" ? "text-fail" : "text-muted-foreground",
          )}
        >
          {pending ? "Awaiting your approval" : plan.status === "approved" ? "Approved" : plan.status === "rejected" ? "Rejected" : "Cancelled"}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3.5 py-2 text-[12.5px] text-muted-foreground">
        <span>
          Device <b className="font-medium text-foreground">{plan.device}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          Firmware
          {pending ? (
            <Select value={fw} onValueChange={setFw}>
              <SelectTrigger size="sm" className="h-6 px-2 font-mono text-xs" aria-label="Firmware">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fwOptions.map((f) => (
                  <SelectItem key={f} value={f} className="font-mono">
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <b className="font-mono font-medium text-foreground">{plan.fw}</b>
          )}
        </span>
        <span>
          Estimated{" "}
          <b className="font-medium text-foreground">
            {formatDuration(est.demo)} ({formatDuration(est.sim)} simulated)
          </b>
        </span>
      </div>

      <ul>
        {plan.items.map((item) => {
          const on = shownSelected.has(item.testId);
          return (
            <li key={item.testId} className={cn("border-b", !pending && !on && "opacity-55")}>
              <label className={cn("grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 px-3.5 py-2.5", pending && "cursor-pointer")}>
                <Checkbox
                  className="mt-0.5"
                  checked={on}
                  disabled={!pending}
                  aria-label={`Include ${item.testId}`}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v) next.add(item.testId);
                    else next.delete(item.testId);
                    setSelected(next);
                  }}
                />
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[13px]">{item.testId}</span>
                  <b className="font-medium">{item.name}</b>
                  <span className="text-xs text-faint-foreground">v{item.version}</span>
                </span>
                <span className="text-right text-xs whitespace-nowrap text-faint-foreground">{formatDuration(item.duration.sim_s)}</span>
                <span className="col-start-2 text-[12.5px] text-muted-foreground">{item.rationale}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {pending && decide.isError && (
        <p role="alert" className="flex items-start gap-2 border-b bg-fail-soft px-3.5 py-2 text-[12.5px] text-fail">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          <span>
            {decide.variables?.decision === "reject" ? "Could not reject the plan" : "Could not approve the plan"}: {decide.error.message}
          </span>
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        {pending && !rejecting && (
          <>
            <Button onClick={approve} disabled={decide.isPending}>
              <Check aria-hidden="true" />
              Approve &amp; run
            </Button>
            <Button variant="outline" onClick={() => setRejecting(true)} disabled={decide.isPending}>
              Reject
            </Button>
            <span className="flex-1" />
            <span className="text-[12.5px] text-muted-foreground">{edited ? "Edited: the agent receives your changes." : "Uncheck tests or change firmware to edit the plan."}</span>
          </>
        )}
        {pending && rejecting && (
          <div className="grid w-full gap-2">
            <Textarea
              autoFocus
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional: tell BenchPilot what to change"
              aria-label="Reject comment"
            />
            <div className="flex gap-2">
              <Button variant="destructive" onClick={reject} disabled={decide.isPending}>
                Reject plan
              </Button>
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {plan.status === "approved" && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-pass">
            <Check className="size-4" aria-hidden="true" />
            Approved by you · {plan.approvedItems?.length ?? plan.items.length} of {plan.items.length} tests
          </span>
        )}
        {plan.status === "rejected" && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-fail">
            <X className="size-4" aria-hidden="true" />
            <span>
              Rejected by you{plan.comment && <span className="font-normal text-muted-foreground">: “{plan.comment}”</span>}
            </span>
          </span>
        )}
        {plan.status === "cancelled" && <span className="text-[12.5px] text-muted-foreground">Cancelled: the turn ended before a decision.</span>}
      </footer>
    </section>
  );
}
