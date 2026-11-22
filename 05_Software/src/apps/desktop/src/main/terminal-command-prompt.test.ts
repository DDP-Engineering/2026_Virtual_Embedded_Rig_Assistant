import { afterEach, expect, it, vi } from "vitest";
import { TerminalCommandPrompt } from "./terminal-command-prompt.js";

afterEach(() => vi.useRealTimers());

it.each(["powershell", "bash"] as const)(
  "starts a clean %s shell without a line-editing shortcut or profile hook",
  (shell) => {
    const prompt = new TerminalCommandPrompt();
    const startup = prompt.startup(shell, { PATH: "/bin", PROMPT_COMMAND: "read pending" });
    if (shell === "powershell") {
      expect(startup.args).toContain("-NoProfile");
      const script = Buffer.from(startup.args.at(-1)!, "base64").toString("utf16le");
      expect(script).toContain("[Console]::ReadLine()");
      expect(script).toContain("[Console]::Write(");
      expect(script).toContain(prompt.marker);
    } else {
      expect(startup.args).toEqual(["--noprofile", "--norc", "-i"]);
      expect(startup.env.PROMPT_COMMAND).toBeUndefined();
      expect(startup.env.PS1).toContain(prompt.marker);
    }
  },
);

it("requires the whole initial prompt, strips split markers and grants execution only once", async () => {
  const prompt = new TerminalCommandPrompt();
  let ready = false;
  const pending = prompt.wait().then(() => {
    ready = true;
  });
  expect(prompt.output(`PS work> ${prompt.marker.slice(0, 13)}`, vi.fn())).toBe("PS work> ");
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(prompt.output(`${prompt.marker.slice(13)}tail`, vi.fn())).toBe("tail");
  await pending;
  expect(ready).toBe(true);
  prompt.consume();
  expect(() => prompt.consume()).toThrow();
  prompt.output(prompt.marker, vi.fn());
  await expect(prompt.wait()).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
});

it("prompts a PowerShell outside Full Language with allowed commands behind a distinct marker", () => {
  const prompt = new TerminalCommandPrompt();
  const script = Buffer.from(prompt.startup("powershell", {}).args.at(-1)!, "base64").toString("utf16le");
  expect(script.startsWith("if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage') {")).toBe(
    true,
  );
  const [full, other] = script.split("} else {");
  // The Full Language branch is the earlier prompt, exactly.
  expect(full).toBe(
    `if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage') { [Console]::Write("PS $($executionContext.SessionState.Path.CurrentLocation)> ${prompt.marker}"); $veraInitialCommand = [Console]::ReadLine(); if ($null -ne $veraInitialCommand) { . ([scriptblock]::Create($veraInitialCommand)) }; Remove-Variable veraInitialCommand -ErrorAction SilentlyContinue `,
  );
  expect(other).toContain(
    'Write-Host -NoNewline "PS $($executionContext.SessionState.Path.CurrentLocation)> ',
  );
  expect(other).toContain("$veraInitialCommand = Read-Host;");
  expect(other).toContain("Invoke-Expression $veraInitialCommand");
  expect(other).toContain(prompt.constrainedMarker);
  // Constrained Language refuses method calls on these types.
  expect(other).not.toMatch(/\[(Console|scriptblock|Convert|Text\.Encoding)\]/);
});

it("marks a terminal constrained only by the constrained marker, stripped when split in either part", async () => {
  // A cut inside the shared prefix, and one inside ";constrained", past the Full marker's length.
  for (const cut of [20, new TerminalCommandPrompt().marker.length + 3]) {
    const prompt = new TerminalCommandPrompt();
    expect(prompt.constrained).toBe(false);
    const marker = prompt.constrainedMarker;
    expect(prompt.output(`PS C:\\bench> ${marker.slice(0, cut)}`, vi.fn())).toBe("PS C:\\bench> ");
    expect(prompt.output(`${marker.slice(cut)}next`, vi.fn())).toBe("next");
    await prompt.wait();
    expect(prompt.constrained).toBe(true);
  }
  const full = new TerminalCommandPrompt();
  full.output(`PS C:\\bench> ${full.marker}`, vi.fn());
  await full.wait();
  expect(full.constrained).toBe(false);
});

it("takes the mode from the marker that proves the prompt, also after a timeout", async () => {
  const full = new TerminalCommandPrompt();
  full.output(full.marker, vi.fn());
  await full.wait();
  // A later constrained marker proves nothing more and does not change the mode.
  expect(full.output(full.constrainedMarker, vi.fn())).toBe("");
  expect(full.constrained).toBe(false);
  vi.useFakeTimers();
  const late = new TerminalCommandPrompt();
  const pending = late.wait();
  const refused = expect(pending).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
  await vi.advanceTimersByTimeAsync(5000);
  await refused;
  expect(late.dispatchEligible).toBe(false);
  late.output(late.constrainedMarker, vi.fn());
  expect(late.dispatchEligible).toBe(true);
  await late.wait();
  expect(late.constrained).toBe(true);
});

it("does not revive a proof after input or closure, including while waiting for the first prompt", async () => {
  const prompt = new TerminalCommandPrompt();
  const pending = prompt.wait();
  prompt.invalidate();
  prompt.output(prompt.marker, vi.fn());
  await expect(pending).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
});

it("rechecks a prompt invalidated after readiness but before dispatch", async () => {
  const prompt = new TerminalCommandPrompt();
  prompt.output(prompt.marker, vi.fn());
  await prompt.wait();
  prompt.invalidate();
  expect(() => prompt.consume()).toThrow();
});

it("answers split startup console queries without command characters, but leaves later queries to the surface", async () => {
  const prompt = new TerminalCommandPrompt();
  const reply = vi.fn();
  expect(prompt.output("\u001b[", reply)).toBe("");
  expect(prompt.output("6n", reply)).toBe("");
  expect(reply).toHaveBeenCalledExactlyOnceWith("\u001b[1;1R");
  expect(prompt.output(`prompt${prompt.marker}\u001b[6n`, reply)).toBe("prompt\u001b[6n");
  await prompt.wait();
  expect(reply).toHaveBeenCalledTimes(1);
});

it("does not send startup replies after any user input has invalidated readiness", () => {
  const prompt = new TerminalCommandPrompt();
  const reply = vi.fn();
  prompt.invalidate();
  expect(prompt.output("\u001b[6n", reply)).toBe("\u001b[6n");
  expect(reply).not.toHaveBeenCalled();
});

it("excludes a timed-out startup and refuses another wait immediately without a second timer", async () => {
  vi.useFakeTimers();
  const prompt = new TerminalCommandPrompt();
  expect(prompt.dispatchEligible).toBe(true);
  const pending = expect(prompt.wait()).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(prompt.dispatchEligible).toBe(false);
  await expect(prompt.wait()).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
  expect(vi.getTimerCount()).toBe(0);
});

it("recovers a pristine timed-out shell only after the entire expected marker arrives", async () => {
  vi.useFakeTimers();
  const prompt = new TerminalCommandPrompt();
  const pending = expect(prompt.wait()).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
  prompt.output(prompt.marker.slice(0, 13), vi.fn());
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  const reply = vi.fn();
  // The marker's prefix must survive the timeout without granting readiness for a partial marker.
  expect(prompt.dispatchEligible).toBe(false);
  prompt.output(prompt.marker.slice(13, -1), reply);
  expect(prompt.dispatchEligible).toBe(false);
  prompt.output(prompt.marker.slice(-1), reply);
  expect(prompt.dispatchEligible).toBe(true);
  await prompt.wait();
  prompt.consume();
  expect(prompt.dispatchEligible).toBe(false);
});

it("services late startup queries without granting eligibility before the expected prompt", async () => {
  vi.useFakeTimers();
  const prompt = new TerminalCommandPrompt();
  const pending = expect(prompt.wait()).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  const reply = vi.fn();
  prompt.output(`PS work> ${new TerminalCommandPrompt().marker}\u001b[6n`, reply);
  expect(reply).toHaveBeenCalledExactlyOnceWith("\u001b[1;1R");
  expect(prompt.dispatchEligible).toBe(false);
  prompt.output(prompt.marker, reply);
  expect(prompt.dispatchEligible).toBe(true);
  await prompt.wait();
});

it("never restores timed-out eligibility after invalidation, even when the expected marker arrives", async () => {
  vi.useFakeTimers();
  const prompt = new TerminalCommandPrompt();
  const pending = expect(prompt.wait()).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  prompt.invalidate();
  const reply = vi.fn();
  prompt.output(`${prompt.marker}\u001b[6n`, reply);
  expect(prompt.dispatchEligible).toBe(false);
  expect(reply).not.toHaveBeenCalled();
  await expect(prompt.wait()).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
});

it("rejects all startup waiters when the first timeout expires", async () => {
  vi.useFakeTimers();
  const prompt = new TerminalCommandPrompt();
  const first = expect(prompt.wait()).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
  await vi.advanceTimersByTimeAsync(1000);
  const second = expect(prompt.wait()).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
  await vi.advanceTimersByTimeAsync(4000);
  await Promise.all([first, second]);
  expect(prompt.dispatchEligible).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
