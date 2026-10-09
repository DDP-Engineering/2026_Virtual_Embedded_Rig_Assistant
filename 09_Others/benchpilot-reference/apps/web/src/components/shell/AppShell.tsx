import { PlugZap } from "lucide-react";
import { Outlet, useNavigate } from "react-router";
import { toast } from "sonner";
import { useLlmSettings, useUpdateLlmSettings } from "@/api/queries";
import { EvidenceDrawerProvider } from "@/components/evidence/EvidenceContext";
import { Button } from "@/components/ui/button";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";

/** 05 App shell: "No model configured → banner 'Connect a model or use Demo replay' with two buttons". */
function ModelBanner() {
  const { data } = useLlmSettings();
  const update = useUpdateLlmSettings();
  const navigate = useNavigate();
  if (!data || data.active) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-primary/40 bg-primary-soft px-6 py-2.5">
      <PlugZap className="size-4 text-primary" aria-hidden="true" />
      <p className="min-w-60 flex-1">
        <b className="font-semibold">Connect a model or use Demo replay.</b> <span className="text-muted-foreground">BenchPilot needs a model to answer.</span>
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={update.isPending}
        onClick={() => update.mutate({ active: "replay" }, { onSuccess: () => toast.success("Demo replay is active"), onError: (e) => toast.error(e.message) })}
      >
        Use demo replay
      </Button>
      <Button size="sm" onClick={() => navigate("/settings")}>
        Connect a model
      </Button>
    </div>
  );
}

/** Nav rail | (top bar / banner / page). Pages own their inner layout (e.g. the three-column session workspace). */
export function AppShell() {
  return (
    <EvidenceDrawerProvider>
      <div className="grid h-full min-w-[1280px] grid-cols-[68px_minmax(0,1fr)] grid-rows-[52px_minmax(0,1fr)] max-[860px]:min-w-0 max-[860px]:grid-cols-1 max-[860px]:grid-rows-[auto_auto_minmax(0,1fr)]">
        <NavRail />
        <TopBar />
        <main className="col-start-2 row-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden max-[860px]:col-start-1 max-[860px]:row-start-3">
          <ModelBanner />
          <div className="min-h-0 flex-1 overflow-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </EvidenceDrawerProvider>
  );
}
