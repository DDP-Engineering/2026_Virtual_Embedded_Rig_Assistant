/**
 * Reads the JSONL event stream of `vera run --format jsonl`: one `{sessionId, seq?, event}` object per
 * line. Live events (`message.delta`, `reasoning.delta`, `tool.update`) carry no `seq`.
 */
export function parseEventLines(text) {
  const lines = [];
  let invalid = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      const line = JSON.parse(raw);
      if (line && typeof line === "object" && line.event && typeof line.event.type === "string")
        lines.push(line);
      else invalid++;
    } catch {
      invalid++;
    }
  }
  return { lines, invalid };
}

/** Summary of one run that the families score: tools, approvals, answer, citations, usage, outcome. */
export function summarizeEvents(lines) {
  const tools = [];
  const byCall = new Map();
  const approvals = [];
  const byApproval = new Map();
  const messages = [];
  const errors = [];
  let stopReason = null;
  let usage = { input: 0, output: 0 };
  let compactions = 0;
  for (const { event } of lines) {
    switch (event.type) {
      case "tool.started": {
        const tool = { callId: event.callId, name: event.name, args: event.args, ok: null };
        tools.push(tool);
        byCall.set(event.callId, tool);
        break;
      }
      case "tool.done": {
        const tool = byCall.get(event.callId);
        if (tool) {
          tool.ok = event.ok;
          if (!event.ok) tool.error = event.summary;
        }
        break;
      }
      case "approval.requested": {
        const approval = {
          approvalId: event.approvalId,
          callId: event.callId,
          tool: event.tool,
          path: event.path,
          decision: null,
          ...(event.program ? { program: event.program } : {}),
          ...(event.download ? { download: event.download } : {}),
        };
        approvals.push(approval);
        byApproval.set(event.approvalId, approval);
        break;
      }
      case "approval.decided": {
        const approval = byApproval.get(event.approvalId);
        if (approval) {
          approval.decision = event.decision;
          approval.by = event.by;
        }
        break;
      }
      case "message.done":
        if (event.text.trim()) messages.push({ text: event.text, citations: event.citations ?? [] });
        break;
      case "usage.updated":
        // Updates carry the session's running totals; a run is one fresh session.
        usage = {
          input: Math.max(usage.input, event.inputTokens),
          output: Math.max(usage.output, event.outputTokens),
        };
        break;
      case "context.compacted":
        compactions++;
        break;
      case "turn.done":
        stopReason = event.stopReason;
        break;
      case "error":
        errors.push({ code: event.code, messageKey: event.messageKey });
        break;
    }
  }
  const last = messages.at(-1);
  return {
    tools,
    approvals,
    answer: last?.text ?? "",
    messages: messages.map((m) => m.text),
    citations: messages.flatMap((m) => m.citations),
    usage,
    compactions,
    stopReason,
    errors,
  };
}

export const toolNames = (summary) => summary.tools.map((tool) => tool.name);

/** Share of valid citations, or null when the answers cite nothing. */
export function citationValidity(summary) {
  if (!summary.citations.length) return null;
  return summary.citations.filter((c) => c.valid).length / summary.citations.length;
}
