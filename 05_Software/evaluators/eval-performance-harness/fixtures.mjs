// REQ-TEST-df5ff0ba REQ-SEC-4bebe590
import { contentHash, hash } from "./report.mjs";

export const tiers = { small: 20, medium: 200, large: 2000, payload: 200 };
export function fixtures() {
  const sessions = [];
  for (const [tier, messages] of Object.entries({ anchor: 20, ...tiers }))
    for (const side of ["a", "b"]) {
      const id = `ses_${String(sessions.length + 1).padStart(26, "0")}`,
        title = `Performance ${tier} ${side}`;
      const events = [{ type: "session.updated", title, status: "idle", mode: "ask", modelRef: null }],
        stored = [],
        items = [],
        turns = [];
      for (let i = 0; i < messages; i += 2) {
        const turn = `turn_${i}`,
          user = `user_${i}`,
          assistant = `assistant_${i}`;
        const first = i === 0 ? `PERF_FIRST_${tier}_${side}` : `Prompt ${i}`;
        const last = i === messages - 2 ? `PERF_LAST_${tier}_${side}` : `Answer ${i}`;
        const prompt = `${first}\n\nInspect board register ${i}.`,
          answer = `${last}\n\n**Captured result**: board ready.\n\n\`\`\`c\nint value = ${i};\n\`\`\`\n`;
        events.push(
          { type: "message.user", messageId: user, text: prompt },
          { type: "turn.started", turnId: turn },
        );
        items.push({ kind: "user", id: user, text: prompt });
        turns.push({ turnId: turn, steps: i % 10 === 0 ? 1 : 0, stopReason: "end" });
        if (i % 10 === 0) {
          const callId = `call_${i}`;
          items.push({
            kind: "tool",
            id: callId,
            turnId: turn,
            name: "read",
            args: { path: "board.txt" },
            status: "ok",
            summary: "Captured board output",
            preview:
              tier === "payload"
                ? "captured output\n".repeat(4096).padEnd(65536, ".").slice(0, 65536)
                : "board ready",
            durationMs: 1,
          });
          events.push(
            { type: "tool.started", callId, name: "read", args: { path: "board.txt" } },
            {
              type: "tool.done",
              callId,
              ok: true,
              summary: "Captured board output",
              preview:
                tier === "payload"
                  ? "captured output\n".repeat(4096).padEnd(65536, ".").slice(0, 65536)
                  : "board ready",
              durationMs: 1,
            },
          );
        }
        events.push(
          {
            type: "message.done",
            messageId: assistant,
            text: answer,
            citations: [{ ref: "board.txt#L1-L2", valid: true }],
          },
          { type: "turn.done", turnId: turn, stopReason: "end" },
        );
        items.push({
          kind: "assistant",
          id: assistant,
          turnId: turn,
          text: answer,
          streaming: false,
          citations: [{ ref: "board.txt#L1-L2", valid: true }],
        });
        stored.push(
          { role: "user", content: [{ type: "text", text: prompt }], timestamp: 1 },
          {
            role: "assistant",
            content: [{ type: "text", text: answer }],
            api: "openai-completions",
            provider: "fixture",
            model: "fixture",
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: 1,
          },
        );
      }
      events.push({
        type: "artifact.saved",
        artifactId: `art_${tier}_${side}`,
        name: "capture.md",
        bytes: 16,
      });
      const expected = {
        snapshot: {
          title,
          status: "idle",
          modelRef: null,
          mode: "ask",
          activeTurnId: null,
          interrupted: [],
          items,
          turns,
          approvals: [],
          changes: [],
          artifacts: [{ artifactId: `art_${tier}_${side}`, name: "capture.md", bytes: 16 }],
          todos: [],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
        seq: events.length,
      };
      sessions.push({
        snapshotHash: contentHash(expected),
        id,
        title,
        tier,
        side,
        messages,
        items: messages + Math.ceil(messages / 10),
        events,
        stored,
        first: `PERF_FIRST_${tier}_${side}`,
        last: `PERF_LAST_${tier}_${side}`,
      });
    }
  const manifest = {
    format: 1,
    generator: 1,
    seed: "vera-session-perf-1",
    sessions: sessions.map(({ events, stored, ...s }) => ({
      ...s,
      eventCount: events.length,
      eventBytes: Buffer.byteLength(JSON.stringify(events)),
      storedBytes: Buffer.byteLength(JSON.stringify(stored)),
      contentHash: hash({ events, stored }),
    })),
  };
  return { sessions, manifest, fixtureHash: hash(manifest) };
}
