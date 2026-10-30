import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { SessionEvent } from "@vera/shared";

export function promptApproval(
  request: Extract<SessionEvent, { type: "approval.requested" }>,
  signal: AbortSignal,
  input: Readable = process.stdin,
  output: Writable = process.stderr,
  scrub: (text: string) => string = (s) => s,
): Promise<"approved" | "denied" | "aborted"> {
  if (signal.aborted) return Promise.resolve("aborted");
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
    output.write(
      safe(
        request.tool === "web_download" && request.download
          ? `\n${request.tool} ${JSON.stringify(request.path)}\nSource: ${request.download.url}\nMaximum: ${request.download.maxBytes} bytes\n`
          : `\n${request.tool} ${JSON.stringify(request.path)} (${request.bytes} bytes)\n${request.diff}\n`,
      ),
    );
    const reader = createInterface({ input, output, terminal: false });
    let done = false;
    function finish(decision: "approved" | "denied" | "aborted") {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", abort);
      reader.close();
      resolve(decision);
    }
    const abort = () => finish("aborted");
    signal.addEventListener("abort", abort, { once: true });
    reader.on("close", () => finish("denied"));
    reader.on("line", (answer) => {
      const choice = answer.trim().toLowerCase();
      if (choice === "a" || choice === "approve") finish("approved");
      else if (choice === "d" || choice === "deny") finish("denied");
      else output.write("Choose A to approve or D to deny: ");
    });
    output.write("Choose A to approve or D to deny: ");
    if (signal.aborted) abort();
  });
}
