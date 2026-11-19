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

it("times out without claiming readiness when shell startup never produces the expected prompt", async () => {
  vi.useFakeTimers();
  const prompt = new TerminalCommandPrompt();
  const pending = expect(prompt.wait()).rejects.toMatchObject({ messageKey: "chatActions.promptNotReady" });
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
});
