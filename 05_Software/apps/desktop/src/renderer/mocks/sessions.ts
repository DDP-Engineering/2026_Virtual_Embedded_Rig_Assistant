import {
  applySessionEvent,
  emptySessionState,
  isLiveSessionEvent,
  type SessionEvent,
  type SessionSummary,
  veraError,
} from "@vera/shared";
import { sessionFixtures } from "./session-fixtures.js";

export class MockSessions {
  private number = 0;
  private readonly sessions = new Map<
    string,
    {
      summary: SessionSummary;
      events: SessionEvent[];
      live?: SessionEvent[];
      active: boolean;
      stop: boolean;
      done?: Promise<void>;
      approval?: {
        id: string;
        digest: string;
        turnId: string;
        resolve: (decision: "approved" | "denied" | "aborted") => void;
      };
    }
  >();
  private readonly listeners = new Map<string, Set<(event: SessionEvent) => void>>();
  constructor(
    private readonly current: () => {
      id: string;
      readOnly: boolean;
      model: string | null;
      mode: SessionSummary["mode"];
    },
  ) {}
  seedFixtures() {
    if ([...this.sessions.keys()].some((key) => key.startsWith(`${this.current().id}/`))) return;
    for (const fixture of sessionFixtures) {
      const summary = this.invoke("session.create", {}) as SessionSummary;
      const row = this.row(summary.id);
      for (const event of fixture.events) this.emit(summary.id, event);
      row.summary.title = fixture.title;
      row.summary.status = fixture.live ? "running" : fixture.title === "Provider error" ? "error" : "idle";
      row.active = !!fixture.live;
      if (fixture.live) row.live = fixture.live;
      this.emit(summary.id, { type: "session.updated", title: fixture.title, status: row.summary.status });
    }
  }
  private key(id: string) {
    return `${this.current().id}/${id}`;
  }
  private row(id: string) {
    const row = this.sessions.get(this.key(id));
    if (!row) throw veraError("NOT_FOUND");
    return row;
  }
  private writable() {
    if (this.current().readOnly) throw veraError("DENIED");
  }
  private emit(id: string, event: SessionEvent, key = this.key(id)) {
    const row = this.sessions.get(key);
    if (!row) throw veraError("NOT_FOUND");
    if (!isLiveSessionEvent(event)) row.events.push(structuredClone(event));
    for (const on of this.listeners.get(key) ?? [])
      try {
        on(structuredClone(event));
      } catch {
        /* observer */
      }
  }
  private idle(id: string) {
    this.writable();
    const row = this.row(id);
    if (row.active) throw veraError("BUSY");
    return row;
  }
  invoke(channel: string, raw: unknown): unknown {
    const request = raw as {
      sessionId: string;
      text: string;
      title: string;
      modelRef: string | null;
      mode: SessionSummary["mode"];
      approvalId: string;
      requestSha256: string;
      decision: "approved" | "denied";
      switchToAutoEdit?: boolean;
    };
    if (channel === "session.list") {
      this.current();
      return [...this.sessions.entries()]
        .filter(([key]) => key.startsWith(`${this.current().id}/`))
        .map(([, row]) => row.summary);
    }
    if (channel === "session.create") {
      this.writable();
      const id = `ses_${String(++this.number).padStart(26, "0")}`;
      const now = new Date().toISOString();
      const summary: SessionSummary = {
        id,
        title: "",
        createdAt: now,
        updatedAt: now,
        modelRef: request.modelRef ?? null,
        mode: request.mode ?? this.current().mode,
        status: "idle",
        archived: false,
      };
      this.sessions.set(this.key(id), { summary, events: [], active: false, stop: false });
      this.emit(id, {
        type: "session.updated",
        title: "",
        status: "idle",
        mode: summary.mode,
        modelRef: summary.modelRef,
      });
      return summary;
    }
    const id = request.sessionId;
    const row = this.row(id);
    if (channel === "session.get")
      return { snapshot: row.events.reduce(applySessionEvent, emptySessionState()), seq: row.events.length };
    if (channel === "session.stop") {
      this.writable();
      row.stop = true;
      if (row.approval) this.decide(id, "aborted", "user");
      if (row.active && row.live) {
        row.active = false;
        delete row.live;
        row.summary.status = "idle";
        this.emit(id, { type: "turn.done", turnId: "stream-turn", stopReason: "aborted" });
        return { stopped: true };
      }
      return { stopped: row.active };
    }
    if (channel === "session.approval.decide") {
      this.writable();
      if (
        !row.active ||
        !row.approval ||
        row.approval.id !== request.approvalId ||
        row.approval.digest !== request.requestSha256
      )
        throw veraError("CONFLICT");
      if (request.switchToAutoEdit && request.decision !== "approved") throw veraError("INVALID");
      this.decide(id, request.decision, "user");
      if (request.switchToAutoEdit) {
        row.summary.mode = "auto-edit";
        this.emit(id, { type: "session.updated", mode: "auto-edit" });
      }
      return {};
    }
    if (channel === "session.mode.set") {
      this.writable();
      row.summary.mode = request.mode;
      this.emit(id, { type: "session.updated", mode: request.mode });
      if (request.mode === "read-only" && row.approval) this.decide(id, "aborted", "mode");
      return row.summary;
    }
    this.idle(id);
    row.summary.updatedAt = new Date().toISOString();
    if (channel === "session.delete") {
      this.sessions.delete(this.key(id));
      this.listeners.delete(this.key(id));
      return {};
    }
    if (channel === "session.rename") {
      row.summary.title = request.title;
      this.emit(id, { type: "session.updated", title: request.title });
      return row.summary;
    }
    if (channel === "session.model.set") {
      row.summary.modelRef = request.modelRef;
      this.emit(id, { type: "session.updated", modelRef: request.modelRef });
      return row.summary;
    }
    if (channel === "session.send") {
      const key = this.key(id);
      row.active = true;
      row.stop = false;
      const turnId = `turn_${++this.number}`,
        messageId = `message_${++this.number}`;
      if (!row.summary.title) {
        row.summary.title = request.text.slice(0, 60);
        this.emit(id, { type: "session.updated", title: row.summary.title });
      }
      this.emit(id, { type: "message.user", messageId, text: request.text });
      row.summary.status = "running";
      this.emit(id, { type: "turn.started", turnId });
      row.done = Promise.resolve()
        .then(() => Promise.resolve())
        .then(async () => {
          if (/edit/i.test(request.text) && row.summary.mode !== "read-only" && !row.stop) {
            const callId = `edit_${++this.number}`;
            this.emit(
              id,
              {
                type: "tool.started",
                callId,
                name: "edit",
                args: { path: "docs/notes/bringup.md", oldString: "old", newString: "new" },
              },
              key,
            );
            const approvalId = `apv_${String(++this.number).padStart(26, "0")}`,
              digest = "a".repeat(64);
            const decision = new Promise<"approved" | "denied" | "aborted">((resolve) => {
              row.approval = { id: approvalId, digest, turnId, resolve };
            });
            row.summary.status = "awaiting_approval";
            this.emit(
              id,
              {
                type: "approval.requested",
                approvalId,
                callId,
                requestSha256: digest,
                tool: "edit",
                path: "docs/notes/bringup.md",
                diff: "--- docs/notes/bringup.md\n+++ docs/notes/bringup.md\n@@ -1 +1 @@\n-old\n+new\n",
                bytes: 4,
              },
              key,
            );
            if (row.summary.mode === "auto-edit" && row.approval) this.decide(id, "approved", "mode");
            const outcome = await decision;
            this.emit(
              id,
              {
                type: "tool.done",
                callId,
                ok: outcome === "approved",
                summary:
                  outcome === "approved"
                    ? "Mock change applied."
                    : outcome === "denied"
                      ? "The user denied this change."
                      : "Aborted.",
                durationMs: 0,
              },
              key,
            );
          }
          if (!row.stop) {
            const messageId = `message_${++this.number}`;
            this.emit(id, { type: "message.delta", messageId, text: "Mock response." }, key);
            this.emit(id, { type: "message.done", messageId, text: "Mock response.", citations: [] }, key);
          }
          row.active = false;
          row.summary.status = "idle";
          this.emit(id, { type: "turn.done", turnId, stopReason: row.stop ? "aborted" : "end" }, key);
        });
      return { turnId, messageId };
    }
    throw veraError("NOT_FOUND");
  }
  private decide(id: string, decision: "approved" | "denied" | "aborted", by: "user" | "mode") {
    const row = this.row(id),
      pending = row.approval;
    if (!pending) throw veraError("CONFLICT");
    delete row.approval;
    row.summary.status = "running";
    this.emit(id, { type: "approval.decided", approvalId: pending.id, decision, by });
    pending.resolve(decision);
  }
  subscribe(id: string, sinceSeq: number, on: (event: SessionEvent) => void) {
    const row = this.row(id);
    const key = this.key(id);
    const listeners = this.listeners.get(key) ?? new Set();
    const queued: SessionEvent[] = [];
    let replay = true;
    const forward = (e: SessionEvent) => {
      if (replay) queued.push(e);
      else on(e);
    };
    listeners.add(forward);
    this.listeners.set(key, listeners);
    for (const e of row.events.slice(sinceSeq)) on(structuredClone(e));
    for (const e of row.live ?? []) on(structuredClone(e));
    replay = false;
    for (const e of queued) on(e);
    return () => listeners.delete(forward);
  }
  async close(): Promise<void> {
    this.listeners.clear();
    const pending: Promise<void>[] = [];
    for (const [key, row] of this.sessions)
      if (row.active) {
        row.stop = true;
        if (row.approval) {
          const pending = row.approval;
          delete row.approval;
          this.emit(
            row.summary.id,
            {
              type: "approval.decided",
              approvalId: pending.id,
              decision: "aborted",
              by: "user",
            },
            key,
          );
          pending.resolve("aborted");
        }
        if (row.done) pending.push(row.done);
      }
    await Promise.all(pending);
  }
}
