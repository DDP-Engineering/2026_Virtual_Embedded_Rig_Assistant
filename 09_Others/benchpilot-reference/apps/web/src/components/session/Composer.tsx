import { Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  status: "idle" | "running" | "awaiting_approval";
  chips: string[];
  disabled?: boolean;
}

const HINT = {
  idle: "Enter to send · Shift+Enter for a new line",
  running: "BenchPilot is working. Stop ends the turn.",
  awaiting_approval: "Waiting for your decision on the test plan above.",
};

export function Composer({ value, onChange, onSend, onStop, status, chips, disabled }: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const locked = status !== "idle" || disabled;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  const send = () => {
    const t = value.trim();
    if (t && !locked) onSend(t);
  };

  return (
    <div className="border-t bg-background px-6 pt-2.5 pb-4">
      <div className="mx-auto grid max-w-[780px] gap-2">
        {status === "idle" && chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Suggested prompts">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onSend(c)}
                disabled={disabled}
                className="rounded-full border border-border-strong bg-card px-2.5 py-[5px] text-left text-[12.5px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <form
          className={cn("flex items-end gap-2 rounded-[10px] border border-border-strong bg-card py-1.5 pr-1.5 pl-3", locked && "opacity-70")}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={ref}
            rows={1}
            value={value}
            disabled={status === "awaiting_approval" || disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask BenchPilot… (run tests, compare firmware, analyse a report)"
            aria-label="Message"
            className="max-h-[120px] min-h-6 flex-1 resize-none border-0 bg-transparent py-1 outline-none placeholder:text-faint-foreground disabled:cursor-not-allowed"
          />
          {status === "running" ? (
            <Button type="button" variant="outline" onClick={onStop}>
              <Square className="fill-current" aria-hidden="true" />
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={locked || !value.trim()}>
              Send
            </Button>
          )}
        </form>
        <div className={cn("text-xs text-faint-foreground", status === "awaiting_approval" && "font-medium text-primary")} aria-live="polite">
          {HINT[status]}
        </div>
      </div>
    </div>
  );
}
