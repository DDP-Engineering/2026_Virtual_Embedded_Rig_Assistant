import type { LlmSettings, ProviderId, TestConnectionResponse } from "@benchpilot/shared";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, ExternalLink, LogOut, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api, usingMocks } from "@/api";
import { qk, useAbout, useHealth, useLlmSettings, useUpdateLlmSettings } from "@/api/queries";
import { Page, PageHeader } from "@/components/Placeholder";
import { Spinner } from "@/components/session/ToolCallRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PROVIDERS: { id: ProviderId; name: string; description: string }[] = [
  { id: "anthropic", name: "Anthropic API", description: "Claude models through your API key." },
  { id: "openai", name: "OpenAI API", description: "GPT models through your API key." },
  { id: "custom", name: "Custom endpoint", description: "Any OpenAI-compatible endpoint: Azure OpenAI, LiteLLM, Ollama, vLLM…" },
  {
    id: "chatgpt",
    name: "ChatGPT subscription",
    description: "Sign in with a ChatGPT Plus or Pro account. For demos with a personal subscription; production needs an enterprise endpoint.",
  },
  { id: "replay", name: "Demo replay", description: "Plays back recorded sessions. Tools still run on real data, so the demo works offline." },
];

interface Draft {
  apiKey: string;
  model: string;
  baseUrl: string;
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={id} className="text-[12.5px] font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function TestResult({ result }: { result: TestConnectionResponse | "pending" | undefined }) {
  if (!result) return null;
  if (result === "pending")
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Spinner /> Testing…
      </span>
    );
  const Icon = result.ok ? CircleCheck : CircleX;
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 text-[12.5px]", result.ok ? "text-pass" : "text-fail")}>
      <Icon className="size-4" aria-hidden="true" />
      {result.detail}
      {result.latencyMs !== undefined && result.ok && <span className="text-muted-foreground">· {result.latencyMs} ms</span>}
    </span>
  );
}

function ChatgptSignIn({ settings }: { settings: LlmSettings }) {
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Poll the status while the provider window is open (P3: the callback lands on the server, not in this page).
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    let busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const s = await api.getChatgptAuthStatus();
        if (s.connected || Date.now() - started > 180_000) {
          clearInterval(t);
          setWaiting(false);
          await qc.invalidateQueries({ queryKey: qk.llm });
          if (s.connected) toast.success("Signed in with ChatGPT");
          else toast.error("Sign-in timed out. Try again.");
        }
      } catch {
        // Transient (server restarting): keep polling until the timeout.
      } finally {
        busy = false;
      }
    }, 1500);
    return () => clearInterval(t);
  }, [waiting, attempt, qc]);

  const start = async () => {
    // Open the window inside the click so the popup blocker allows it, then point it at the provider URL.
    const win = window.open("about:blank", "_blank");
    setStarting(true);
    try {
      const { url } = await api.startChatgptAuth();
      if (win && url) {
        win.opener = null;
        win.location.href = url;
      } else {
        win?.close();
        if (url) toast.info("Allow pop-ups for this page, or open the sign-in link from a new tab.");
      }
      setAttempt((n) => n + 1);
      setWaiting(true);
    } catch (e) {
      win?.close();
      setWaiting(false);
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  if (settings.chatgpt.connected)
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <CircleCheck className="size-4 text-pass" aria-hidden="true" />
        {settings.chatgpt.account ? (
          <span>
            Connected as <b className="font-medium">{settings.chatgpt.account}</b>
          </span>
        ) : (
          <span>Signed in with ChatGPT</span>
        )}
        {settings.chatgpt.expiresAt && <span className="text-muted-foreground">· token renews before {formatDateTime(settings.chatgpt.expiresAt)}</span>}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await api.logoutChatgpt();
              toast("Signed out of ChatGPT");
            } catch (e) {
              toast.error((e as Error).message);
            }
            await qc.invalidateQueries({ queryKey: qk.llm });
          }}
        >
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </div>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={starting}
        onClick={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        {starting || waiting ? <Spinner /> : <ExternalLink aria-hidden="true" />}
        {waiting ? "Restart sign-in" : "Sign in with ChatGPT"}
      </Button>
      {waiting && (
        <>
          <span className="text-[12.5px] text-muted-foreground">Waiting for you to finish signing in in the new window…</span>
          <Button variant="ghost" size="sm" onClick={() => setWaiting(false)}>
            Cancel
          </Button>
        </>
      )}
      {!waiting && <span className="text-[12.5px] text-muted-foreground">Opens OpenAI's sign-in page. Uses local port 1455 for the callback.</span>}
    </div>
  );
}

function ProviderCard({ settings, id, name, description, selected, draft, onDraft }: { settings: LlmSettings; id: ProviderId; name: string; description: string; selected: boolean; draft: Draft; onDraft: (d: Partial<Draft>) => void }) {
  const view = settings.providers[id];
  const [test, setTest] = useState<TestConnectionResponse | "pending">();
  const models = settings.models[id] ?? [];
  const runTest = async () => {
    setTest("pending");
    try {
      setTest(await api.testLlmConnection({ provider: id, apiKey: draft.apiKey || undefined, model: draft.model || undefined, baseUrl: draft.baseUrl || undefined }));
    } catch (e) {
      setTest({ ok: false, detail: (e as Error).message });
    }
  };

  return (
    <div className={cn("grid gap-2.5 rounded-[10px] border bg-card px-4 py-3.5 transition-shadow", selected && "border-primary shadow-[0_0_0_1px_var(--primary)]")}>
      <div className="flex flex-wrap items-center gap-2.5">
        <RadioGroupItem value={id} id={`provider-${id}`} />
        <Label htmlFor={`provider-${id}`} className="cursor-pointer text-sm font-semibold">
          {name}
        </Label>
        {settings.active === id && <Badge className="h-5">Active</Badge>}
        {view.configured && id !== "replay" && (
          <Badge variant="outline" className="h-5 gap-1.5 font-normal text-muted-foreground">
            <span className="size-[7px] rounded-full bg-pass" aria-hidden="true" />
            Configured
          </Badge>
        )}
        {id === "chatgpt" && (
          <Badge variant="outline" className="h-5 border-warn text-warn">
            Demo only
          </Badge>
        )}
      </div>
      <p className="text-[12.5px] text-muted-foreground">{description}</p>

      {(id === "anthropic" || id === "openai" || id === "custom") && (
        <form className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5" onSubmit={(e) => e.preventDefault()} aria-label={`${name} credentials`}>
          {id === "custom" && (
            <Field label="Base URL" id={`${id}-url`}>
              <Input id={`${id}-url`} placeholder="https://llm.internal.example/v1" value={draft.baseUrl} onChange={(e) => onDraft({ baseUrl: e.target.value })} />
            </Field>
          )}
          <Field label="API key" id={`${id}-key`}>
            <Input
              id={`${id}-key`}
              type="password"
              autoComplete="off"
              placeholder={view.keyMasked ? `${view.keyMasked} (saved)` : id === "anthropic" ? "sk-ant-…" : "sk-…"}
              value={draft.apiKey}
              onChange={(e) => onDraft({ apiKey: e.target.value })}
            />
          </Field>
          <Field label="Model" id={`${id}-model`}>
            {models.length ? (
              <Select value={draft.model} onValueChange={(v) => onDraft({ model: v })}>
                <SelectTrigger id={`${id}-model`} className="w-full font-mono text-[13px]">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input id={`${id}-model`} placeholder="model id" className="font-mono" value={draft.model} onChange={(e) => onDraft({ model: e.target.value })} />
            )}
          </Field>
        </form>
      )}
      {id === "chatgpt" && <ChatgptSignIn settings={settings} />}
      {id === "chatgpt" && settings.chatgpt.connected && models.length > 0 && (
        <div className="max-w-[280px]">
          <Field label="Model" id="chatgpt-model">
            <Select value={draft.model} onValueChange={(v) => onDraft({ model: v })}>
              <SelectTrigger id="chatgpt-model" className="w-full font-mono text-[13px]">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m} value={m} className="font-mono">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={runTest} disabled={test === "pending"}>
          Test connection
        </Button>
        <TestResult result={test} />
      </div>
    </div>
  );
}

function ModelConnection({ settings }: { settings: LlmSettings }) {
  const [selected, setSelected] = useState<ProviderId>(settings.active ?? "replay");
  const [drafts, setDrafts] = useState<Record<ProviderId, Draft>>(() => {
    const d = {} as Record<ProviderId, Draft>;
    for (const p of PROVIDERS) d[p.id] = { apiKey: "", model: settings.providers[p.id].model ?? "", baseUrl: settings.providers[p.id].baseUrl ?? "" };
    return d;
  });
  const update = useUpdateLlmSettings();
  const draft = drafts[selected];
  const providerName = PROVIDERS.find((p) => p.id === selected)!.name;

  const save = () => {
    const keyed = selected === "anthropic" || selected === "openai" || selected === "custom";
    // Keys are write-only: sent once here, never read back (GET returns `••••1234`), never stored in the browser.
    const provider = keyed
      ? { id: selected, apiKey: draft.apiKey.trim() || undefined, model: draft.model, baseUrl: selected === "custom" ? draft.baseUrl : undefined }
      : selected === "chatgpt" && draft.model
        ? { id: selected, model: draft.model }
        : undefined;
    update.mutate(
      { provider, active: selected },
      {
        onSuccess: () => {
          setDrafts((d) => ({ ...d, [selected]: { ...d[selected], apiKey: "" } }));
          toast.success(`${providerName} is active. Keys stay on the server.`);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <section className="grid gap-3" aria-labelledby="model-connection">
      <h2 id="model-connection" className="text-[15px] font-semibold">
        Model connection
      </h2>
      <RadioGroup value={selected} onValueChange={(v) => setSelected(v as ProviderId)} className="grid gap-3">
        {PROVIDERS.map((p) => (
          <ProviderCard
            key={p.id}
            settings={settings}
            {...p}
            selected={selected === p.id}
            draft={drafts[p.id]}
            onDraft={(patch) => setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], ...patch } }))}
          />
        ))}
      </RadioGroup>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={update.isPending}>
          Save and use {providerName}
        </Button>
        {settings.active && (
          <Button variant="ghost" onClick={() => update.mutate({ active: null }, { onSuccess: () => toast("No model is active") })}>
            Disconnect
          </Button>
        )}
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        Keys and tokens stay on the BenchPilot server and are never sent to the browser. Claude subscriptions can't be used in third-party apps; use an API key.
      </p>
    </section>
  );
}

function DemoCard() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.resetDemo();
      // resetQueries (not clear): drops every cached snapshot (session ids restart at S-0001, so a stale S-0001 with a
      // higher seq must not survive) and refetches what is on screen.
      await qc.resetQueries();
      setOpen(false);
      toast.success(`Demo data reset · next live report ${r.nextReport}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Demo</CardTitle>
        <CardDescription>Restore the post-seed state between demo runs: history RPT-0001…0008, next live report RPT-0009.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (busy) return; // the reseed takes a few seconds; keep the dialog until it answers
            setOpen(next);
            if (next) setError(null);
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline">
              <RotateCcw aria-hidden="true" />
              Reset demo data
            </Button>
          </DialogTrigger>
          <DialogContent showCloseButton={!busy}>
            <DialogHeader>
              <DialogTitle>Reset demo data?</DialogTitle>
              <DialogDescription>
                Any running turn or test run is stopped. Live reports, sessions, analyses and ticket drafts are removed; the history reports RPT-0001…0008 are rebuilt. Settings and credentials are kept.
              </DialogDescription>
            </DialogHeader>
            {busy && (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
                <Spinner />
                Resetting… rebuilding the history reports takes about 10 seconds.
              </p>
            )}
            {error && (
              <p className="text-[13px] text-fail" role="alert">
                Reset failed: {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="destructive" disabled={busy} onClick={() => void reset()}>
                {busy ? "Resetting…" : "Reset"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button variant="ghost" asChild>
          <Link to="/eval">Triage accuracy</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ServerCard() {
  const health = useHealth();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Server</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-1.5">
          <dt className="text-muted-foreground">API</dt>
          <dd>
            {health.isPending && <span className="text-muted-foreground">Checking…</span>}
            {health.isSuccess && <span className="font-medium text-pass">Reachable</span>}
            {health.isError && <span className="font-medium text-fail">Unreachable</span>}
          </dd>
          <dt className="text-muted-foreground">tshark</dt>
          <dd className="font-mono text-[13px] break-words">
            {health.isSuccess ? (health.data.tshark ?? <span className="text-warn">Not found — set TSHARK_PATH</span>) : "—"}
          </dd>
          <dt className="text-muted-foreground">Data</dt>
          <dd className="text-muted-foreground">{usingMocks ? "Mock fixtures in the browser (VITE_API=mock)" : "BenchPilot server (simulated lab datasets)"}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}

/** 08 Licensing: version and a link to the third-party notices (the Windows bundle ships them). */
function AboutCard() {
  const about = useAbout();
  const a = about.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
        <CardDescription>BenchPilot proof of concept. All lab data is synthetic.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-1.5">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono text-[13px]">{a ? a.version : "—"}</dd>
          <dt className="text-muted-foreground">Build</dt>
          <dd className="text-muted-foreground">
            {!a ? "—" : a.distribution === "bundle" ? <span className="font-mono text-[13px] text-foreground">{`${a.gitSha} · ${a.buildDate}`}</span> : "Running from source"}
          </dd>
          <dt className="text-muted-foreground">Node.js</dt>
          <dd className="font-mono text-[13px]">{a ? a.node : "—"}</dd>
          <dt className="text-muted-foreground">Licenses</dt>
          <dd>
            {a?.notices ? (
              <a className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline" href="/api/about/notices" target="_blank" rel="noreferrer">
                Third-party notices <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : (
              <span className="text-muted-foreground">THIRD-PARTY-NOTICES.txt ships with the Windows demo bundle.</span>
            )}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { data } = useLlmSettings();
  return (
    <Page>
      <PageHeader title="Settings" description="Model connection and demo controls." />
      <div className="grid max-w-[820px] gap-6">
        {data ? <ModelConnection settings={data} /> : <Skeleton className="h-96" />}
        <DemoCard />
        <ServerCard />
        <AboutCard />
      </div>
    </Page>
  );
}
