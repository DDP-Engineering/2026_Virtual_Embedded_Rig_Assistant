import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { confirmationMatches, programCommandLine, type SessionEvent } from "@vera/shared";

type ApprovalRequest = Extract<SessionEvent, { type: "approval.requested" }>;
export interface PromptDecision {
  decision: "approved" | "denied" | "aborted";
  /** The typed word that approved an irreversible program command. */
  confirmation?: string;
}
/** A pending program approval with a confirmation word needs the word typed at the prompt. */
const needsWord = (request: ApprovalRequest) => !!request.program?.confirm;

/**
 * The decision the approval flags or a missing terminal make; undefined when the user is asked.
 * A typed confirmation is never given by a flag.
 */
export function flagDecision(
  request: ApprovalRequest,
  approve: "all" | "none" | undefined,
  tty: boolean,
): "approved" | "denied" | undefined {
  if (request.tool === "plugin_install" || request.program?.trial)
    return approve === "none" || !tty ? "denied" : undefined;
  if (needsWord(request)) return approve === undefined && tty ? undefined : "denied";
  if (approve === "all") return "approved";
  if (approve === "none" || !tty) return "denied";
  return undefined;
}
function describe(request: ApprovalRequest): string {
  const program = request.program;
  if (program)
    return [
      "",
      `${request.tool} ${program.program}${program.programVersion ? ` ${program.programVersion}` : ""} (plugin ${program.pluginId}${program.trial ? ", trial" : ""})`,
      `Risk: ${program.risk}`,
      `Command: ${programCommandLine(program.program, program.args)}`,
      `Working directory: ${program.cwd}`,
      `Executable: ${program.executable}`,
      ...program.notes.map((note) => `Note: ${note}`),
      ...program.files.map((file) => `File: ${file.path} ${file.sha256}`),
      ...(program.resources ?? []).map(
        (resource) => `Reserves: ${resource.alias} (${resource.kind} ${resource.resource})`,
      ),
      ...(program.registry ? [`Registry: ${program.registry.path} ${program.registry.sha256}`] : []),
      "",
    ].join("\n");
  return request.tool === "web_download" && request.download
    ? `\n${request.tool} ${JSON.stringify(request.path)}\nSource: ${request.download.url}\nMaximum: ${request.download.maxBytes} bytes\n`
    : `\n${request.tool} ${JSON.stringify(request.path)} (${request.bytes} bytes)\n${request.diff}\n`;
}
export function promptApproval(
  request: ApprovalRequest,
  signal: AbortSignal,
  input: Readable = process.stdin,
  output: Writable = process.stderr,
  scrub: (text: string) => string = (s) => s,
): Promise<PromptDecision> {
  if (signal.aborted) return Promise.resolve({ decision: "aborted" });
  return new Promise((resolve) => {
    // Escape terminal controls from file data; stdout remains the event stream.
    const safe = (text: string) =>
      [...scrub(text)]
        .map((c) => {
          const code = c.charCodeAt(0);
          return (code < 32 && code !== 9 && code !== 10) || code === 127
            ? `\\u${code.toString(16).padStart(4, "0")}`
            : c;
        })
        .join("");
    output.write(safe(describe(request)));
    const reader = createInterface({ input, output, terminal: false });
    const word = request.program?.confirm ?? null;
    const choose = "Choose A to approve or D to deny: ";
    let typing = false;
    let done = false;
    function finish(result: PromptDecision) {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", abort);
      reader.close();
      resolve(result);
    }
    const abort = () => finish({ decision: "aborted" });
    signal.addEventListener("abort", abort, { once: true });
    reader.on("close", () => finish({ decision: "denied" }));
    reader.on("line", (answer) => {
      if (typing) {
        typing = false;
        if (confirmationMatches(word, answer)) finish({ decision: "approved", confirmation: answer.trim() });
        else output.write(safe(`The typed word does not match ${word}. ${choose}`));
        return;
      }
      const choice = answer.trim().toLowerCase();
      if ((choice === "a" || choice === "approve") && word) {
        typing = true;
        output.write(safe(`Type ${word} to confirm: `));
      } else if (choice === "a" || choice === "approve") finish({ decision: "approved" });
      else if (choice === "d" || choice === "deny") finish({ decision: "denied" });
      else output.write(choose);
    });
    output.write(choose);
    if (signal.aborted) abort();
  });
}
