import type { CreateTestbenchRequest } from "@benchpilot/shared";
import { ArrowLeft, ArrowRight, Check, FileText, Upload, X } from "lucide-react";
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { useCatalog, useCreateTestbench, useSkills, useTools } from "@/api/queries";
import { KeyValues } from "@/components/common/Bits";
import { Page, PageHeader } from "@/components/Placeholder";
import { docPathFor, MD_ACCEPT, readMarkdownFile } from "@/components/testbench/DocumentsTab";
import { Box, Chip, FirmwareChips } from "@/components/testbench/parts";
import { SkillsPanel } from "@/components/testbench/SkillsTab";
import { defaultTests, TestsNote, TestsPanel } from "@/components/testbench/TestsTab";
import { defaultTools, ToolsPanel } from "@/components/testbench/ToolsTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

const STEPS = ["Basics", "Documents", "Tools", "Skills", "Tests", "Review & create"] as const;

type Template = CreateTestbenchRequest["template"];

const TEMPLATES: { id: Template; title: string; body: string }[] = [
  {
    id: "tb-01",
    title: "Start from TB-01 template",
    body: "Copies TB-01's documents: TESTBENCH.md, topology.yaml, device and firmware notes, lab notes and test policy. Edit them after creation.",
  },
  { id: "empty", title: "Empty (TESTBENCH.md only)", body: "Starts with a TESTBENCH.md skeleton for the agent instructions. Add documents later." },
];

const parseFirmware = (text: string) => [...new Set(text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];

export function NewTestbenchPage() {
  const navigate = useNavigate();
  const create = useCreateTestbench();
  const tools = useTools();
  const skills = useSkills();
  const catalog = useCatalog();

  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("RTR-AX3000");
  const [firmwareText, setFirmwareText] = useState("2.0.4, 2.1.0");
  const [template, setTemplate] = useState<Template>("tb-01");
  const [uploads, setUploads] = useState<{ path: string; content: string }[]>([]);
  // null = untouched → default to everything enabled once the lists load.
  const [toolSel, setToolSel] = useState<string[] | null>(null);
  const [skillSel, setSkillSel] = useState<string[] | null>(null);
  const [testSel, setTestSel] = useState<string[] | null>(null);

  const enabledTools = toolSel ?? defaultTools(tools.data ?? []);
  const enabledSkills = skillSel ?? (skills.data ?? []).map((s) => s.name);
  const enabledTests = testSel ?? defaultTests(catalog.data ?? []);
  const firmware = parseFirmware(firmwareText);

  const errors = { name: name.trim() ? null : "Name is required.", model: model.trim() ? null : "Device model is required." };
  const basicsValid = !errors.name && !errors.model;
  const last = step === STEPS.length - 1;

  const goTo = (target: number) => {
    if (target > 0 && !basicsValid) {
      setTouched(true);
      setStep(0);
      return;
    }
    setStep(Math.max(0, Math.min(STEPS.length - 1, target)));
  };

  const onCreate = () => {
    if (!basicsValid) return goTo(0);
    const req: CreateTestbenchRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      device: { model: model.trim(), firmware },
      template,
      docs: uploads.length ? uploads : undefined,
      enabled_tools: enabledTools,
      enabled_skills: enabledSkills,
      enabled_tests: enabledTests,
    };
    create.mutate(req, {
      onSuccess: (detail) => {
        toast.success(`Created ${detail.config.id} · ${detail.config.name}`);
        navigate(`/testbenches/${detail.config.id}/overview`);
      },
      onError: (e) => toast.error(`Could not create the testbench: ${e.message}`),
    });
  };

  return (
    <Page>
      <PageHeader title="New testbench" description="Set up a lab the agent can plan and run tests on. Every step can be changed later." />
      <Stepper current={step} canJump={basicsValid} onStep={goTo} />

      {step === 0 && (
        <Box title="Basics">
          <div className="grid max-w-2xl gap-4">
            <Field id="tb-name" label="Name" error={touched ? errors.name : null}>
              <Input id="tb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AX3000 Wi-Fi Lab" aria-invalid={touched && !!errors.name} autoFocus />
            </Field>
            <Field id="tb-desc" label="Description" hint="Optional.">
              <Input id="tb-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this lab is for" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field id="tb-model" label="Device model" error={touched ? errors.model : null}>
                <Input id="tb-model" value={model} onChange={(e) => setModel(e.target.value)} className="font-mono" aria-invalid={touched && !!errors.model} />
              </Field>
              <Field id="tb-fw" label="Firmware versions" hint="Comma-separated. The newest is the release under test.">
                <Input id="tb-fw" value={firmwareText} onChange={(e) => setFirmwareText(e.target.value)} className="font-mono" placeholder="2.0.4, 2.1.0" />
              </Field>
            </div>
            {firmware.length > 0 && <FirmwareChips firmware={firmware} />}
          </div>
        </Box>
      )}

      {step === 1 && <DocumentsStep template={template} onTemplate={setTemplate} uploads={uploads} onUploads={setUploads} />}

      {step === 2 && (
        <StepIntro text="Tools the agent may call. Execution tools always stop for your approval.">
          <ToolsPanel value={enabledTools} onChange={setToolSel} />
        </StepIntro>
      )}
      {step === 3 && (
        <StepIntro text="Skills the agent can load on demand.">
          <SkillsPanel value={enabledSkills} onChange={setSkillSel} />
        </StepIntro>
      )}
      {step === 4 && (
        <StepIntro text="Catalog tests available on this testbench.">
          <TestsPanel value={enabledTests} onChange={setTestSel} />
          <TestsNote />
        </StepIntro>
      )}

      {step === 5 && (
        <Box title="Review">
          <KeyValues
            rows={[
              ["Name", name.trim()],
              ["Description", description.trim() || <span className="text-muted-foreground">—</span>],
              ["Device", <span className="font-mono">{model.trim()}</span>],
              ["Firmware", <FirmwareChips firmware={firmware} />],
              [
                "Documents",
                <span>
                  {TEMPLATES.find((t) => t.id === template)?.title}
                  {uploads.length > 0 && ` + ${uploads.length} uploaded`}
                </span>,
              ],
              [
                "Tools",
                `${enabledTools.length} enabled${
                  tools.data ? ` · ${tools.data.filter((t) => t.requiresApproval && enabledTools.includes(t.name)).length} need approval` : ""
                } · load_skill always on`,
              ],
              ["Skills", enabledSkills.length ? enabledSkills.join(", ") : "None"],
              [
                "Tests",
                enabledTests.length ? (
                  <span className="flex flex-wrap gap-1">
                    {enabledTests.map((t) => (
                      <Chip key={t} mono>
                        {t}
                      </Chip>
                    ))}
                  </span>
                ) : (
                  "None"
                ),
              ],
              ["Simulation", "Shares TB-01's dataset pools (PoC)"],
            ]}
          />
        </Box>
      )}

      <div className="flex items-center gap-2 border-t pt-4">
        <Button variant="ghost" asChild>
          <Link to="/testbenches">Cancel</Link>
        </Button>
        <span className="flex-1" />
        <Button variant="outline" disabled={step === 0 || create.isPending} onClick={() => goTo(step - 1)}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        {last ? (
          <Button disabled={create.isPending} onClick={onCreate}>
            <Check aria-hidden="true" />
            {create.isPending ? "Creating…" : "Create testbench"}
          </Button>
        ) : (
          <Button onClick={() => goTo(step + 1)}>
            Next
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </Page>
  );
}

function Stepper({ current, canJump, onStep }: { current: number; canJump: boolean; onStep: (i: number) => void }) {
  return (
    <nav aria-label="Wizard steps">
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                disabled={!active && !done && !canJump}
                onClick={() => onStep(i)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 text-[13px] whitespace-nowrap hover:bg-accent disabled:pointer-events-none",
                  active ? "font-medium text-foreground" : done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full border text-xs font-semibold tabular-nums",
                    active && "border-primary bg-primary text-primary-foreground",
                    done && "border-primary bg-primary-soft text-primary",
                    !active && !done && "border-border-strong bg-card",
                  )}
                >
                  {done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
                </span>
                {label}
              </button>
              {i < STEPS.length - 1 && <span className={cn("h-px min-w-4 flex-1", done ? "bg-primary" : "bg-border")} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-fail">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function StepIntro({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="grid gap-3">
      <p className="text-[13px] text-muted-foreground">{text} Everything starts enabled.</p>
      {children}
    </div>
  );
}

interface DocumentsStepProps {
  template: Template;
  onTemplate: (t: Template) => void;
  uploads: { path: string; content: string }[];
  onUploads: (u: { path: string; content: string }[]) => void;
}

function DocumentsStep({ template, onTemplate, uploads, onUploads }: DocumentsStepProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    const next = [...uploads];
    for (const file of files) {
      const content = await readMarkdownFile(file);
      if (content === null) continue;
      const path = docPathFor(file.name);
      const existing = next.findIndex((u) => u.path === path);
      if (existing >= 0) next[existing] = { path, content };
      else next.push({ path, content });
    }
    onUploads(next);
  };

  return (
    <Box title="Documents">
      <RadioGroup value={template} onValueChange={(v) => onTemplate(v as Template)} className="grid-cols-2 gap-3" aria-label="Starting documents">
        {TEMPLATES.map((t) => (
          <Label
            key={t.id}
            htmlFor={`tpl-${t.id}`}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-[10px] border bg-card px-4 py-3.5 leading-normal font-normal",
              template === t.id && "border-primary ring-1 ring-primary",
            )}
          >
            <RadioGroupItem id={`tpl-${t.id}`} value={t.id} className="mt-0.5" />
            <span className="grid gap-1">
              <b className="text-sm font-semibold">{t.title}</b>
              <span className="text-[12.5px] leading-snug text-muted-foreground">{t.body}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>

      <div className="mt-2 grid gap-2">
        <div className="flex items-center gap-2">
          <h4 className="flex-1 text-[13px] font-semibold">Additional documents</h4>
          <input ref={fileRef} type="file" accept={MD_ACCEPT} multiple className="hidden" onChange={(e) => void onFiles(e)} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden="true" />
            Upload .md
          </Button>
        </div>
        {uploads.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Optional. Uploaded markdown is searchable by the agent.</p>
        ) : (
          <ul className="grid divide-y rounded-lg border">
            {uploads.map((u) => (
              <li key={u.path} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={u.path}>
                  {u.path}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{u.content.length.toLocaleString("en-US")} chars</span>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${u.path}`} onClick={() => onUploads(uploads.filter((x) => x.path !== u.path))}>
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Box>
  );
}
