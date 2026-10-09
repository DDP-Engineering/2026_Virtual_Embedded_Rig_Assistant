import type { LlmSettings } from "@benchpilot/shared";
import { Check, ChevronsUpDown, Moon, Plus, Sun } from "lucide-react";
import { useMatch, useNavigate } from "react-router";
import { useLlmSettings, useTestbenches } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/use-theme";
import { useActiveTestbench } from "@/hooks/use-active-testbench";

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  custom: "Custom endpoint",
  chatgpt: "ChatGPT",
};

function ModelPill({ settings }: { settings: LlmSettings | undefined }) {
  const navigate = useNavigate();
  if (!settings) return <Badge variant="outline" className="h-6 w-40 animate-pulse border-dashed" aria-label="Loading model status" />;

  const active = settings.active;
  const pill =
    !active ? (
      <Badge variant="outline" className="h-6 border-warn/40 bg-warn-soft px-2.5 font-medium text-warn">
        No model
      </Badge>
    ) : active === "replay" ? (
      <Badge variant="outline" className="h-6 border-warn/40 bg-warn-soft px-2.5 font-medium text-warn">
        Replay
      </Badge>
    ) : (
      <Badge variant="outline" className="h-6 gap-1.5 px-2.5 font-normal text-muted-foreground">
        <span className="size-[7px] rounded-full bg-pass" aria-hidden="true" />
        {PROVIDER_LABEL[active]} · {settings.providers[active].model}
      </Badge>
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={() => navigate("/settings")} className="rounded-full" aria-label="Model connection settings">
          {pill}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {!active ? "No model configured" : active === "replay" ? "Model connection: demo replay (scripted model, real tools)" : "Model connection"}
      </TooltipContent>
    </Tooltip>
  );
}

function TestbenchSwitcher() {
  const { data } = useTestbenches();
  const navigate = useNavigate();
  const match = useMatch("/testbenches/:id/*");
  const [stored, setActive] = useActiveTestbench();
  const activeId = match?.params.id && match.params.id !== "new" ? match.params.id : stored;
  const active = data?.find((t) => t.id === activeId) ?? data?.[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1 hover:bg-accent" aria-label="Switch testbench">
          <strong className="font-mono text-[13px] font-medium">{active?.id ?? "TB-01"}</strong>
          <span className="truncate text-muted-foreground">{active?.name ?? "AX3000 Virtual Lab"}</span>
          <ChevronsUpDown className="size-3.5 text-faint-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Testbenches</DropdownMenuLabel>
        {data?.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => {
              setActive(t.id);
              navigate(`/testbenches/${t.id}/overview`);
            }}
          >
            <span className="font-mono text-xs">{t.id}</span>
            <span className="truncate">{t.name}</span>
            {t.id === active?.id && <Check className="ml-auto" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/testbenches/new")}>
          <Plus aria-hidden="true" />
          New testbench
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const { data: settings } = useLlmSettings();

  return (
    <header className="col-start-2 row-start-1 flex min-w-0 items-center gap-3 border-b bg-card px-4 max-[860px]:col-start-1 max-[860px]:row-start-2 max-[860px]:flex-wrap max-[860px]:gap-2 max-[860px]:py-2">
      <TestbenchSwitcher />

      <div className="flex-1 max-[860px]:hidden" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" tabIndex={0} className="h-6 border-dashed border-border-strong px-2.5 font-normal text-muted-foreground">
            Simulated data
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Test runs replay pre-generated datasets</TooltipContent>
      </Tooltip>

      <ModelPill settings={settings} />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={`Switch to ${nextTheme} theme`} className="text-muted-foreground">
            {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Switch to {nextTheme} theme</TooltipContent>
      </Tooltip>
    </header>
  );
}
