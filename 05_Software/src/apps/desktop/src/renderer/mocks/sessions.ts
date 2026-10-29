import {
  type ArtifactContent,
  applySessionEvent,
  type ChangeDetail,
  emptySessionState,
  isLiveSessionEvent,
  type SessionEvent,
  type SessionSummary,
  veraError,
} from "@vera/shared";
import { sessionFixtures } from "./session-fixtures.js";

export class MockSessions {
  private number = 0;
  private changeNumber = 0;
  private readonly sessions = new Map<
    string,
    {
      summary: SessionSummary;
      events: SessionEvent[];
      changes: ChangeDetail[];
      artifacts: ArtifactContent[];
      live?: SessionEvent[];
      active: boolean;
      stop: boolean;
      turnId?: string;
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
    private readonly reasoningLevels: (model: string) => string[] = () => [],
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
      const started = fixture.events.findLast((event) => event.type === "turn.started");
      if (started) row.turnId = started.turnId;
      if (fixture.live) row.live = fixture.live;
      this.emit(summary.id, { type: "session.updated", title: fixture.title, status: row.summary.status });
    }
  }
  reveal(path: string): Record<string, never> {
    for (const [key, row] of this.sessions)
      if (key.startsWith(`${this.current().id}/`) && row.changes.some((c) => c.path === path)) return {};
    throw veraError("NOT_FOUND");
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
      query: string;
      archived: boolean;
      reasoning: string | null;
    };
    if (channel === "session.list" || channel === "session.search") {
      this.current();
      return [...this.sessions.entries()]
        .filter(([key]) => key.startsWith(`${this.current().id}/`))
        .filter(
          ([, row]) =>
            channel !== "session.search" ||
            row.summary.title.toLowerCase().includes(request.query.toLowerCase()) ||
            row.events.some(
              (e) =>
                (e.type === "message.user" || e.type === "message.queued" || e.type === "message.done") &&
                e.text.toLowerCase().includes(request.query.toLowerCase()),
            ),
        )
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
      this.sessions.set(this.key(id), {
        summary,
        events: [],
        changes: [],
        artifacts: [],
        active: false,
        stop: false,
      });
      this.emit(id, {
        type: "session.updated",
        title: "",
        status: "idle",
        mode: summary.mode,
        modelRef: summary.modelRef,
      });
      return summary;
    }
    if (channel === "changes.get") {
      const changeId = (raw as { changeId: number }).changeId;
      for (const [key, row] of this.sessions)
        if (key.startsWith(`${this.current().id}/`)) {
          const value = row.changes.find((c) => c.changeId === changeId);
          if (value) return structuredClone(value);
        }
      throw veraError("NOT_FOUND");
    }
    if (channel === "artifacts.open" || channel === "artifacts.reveal" || channel === "artifacts.export") {
      const artifactId = (raw as { artifactId: string }).artifactId;
      for (const [key, row] of this.sessions)
        if (key.startsWith(`${this.current().id}/`)) {
          const a = row.artifacts.find((a) => a.artifactId === artifactId);
          if (a)
            return channel === "artifacts.open"
              ? structuredClone(a)
              : channel === "artifacts.export"
                ? { exported: true }
                : {};
        }
      throw veraError("NOT_FOUND");
    }
    const id = request.sessionId;
    const row = this.row(id);
    if (channel === "session.reasoning.get" || channel === "session.reasoning.set") {
      const modelRef = row.summary.modelRef ?? this.current().model;
      if (!modelRef) throw veraError("INVALID");
      const options = this.reasoningLevels(modelRef);
      if (channel === "session.reasoning.set") {
        this.writable();
        if (modelRef !== request.modelRef) throw veraError("CONFLICT");
        if (request.reasoning !== null && !options.includes(request.reasoning)) throw veraError("INVALID");
        this.emit(id, { type: "session.updated", reasoning: request.reasoning });
      }
      const saved = row.events.reduce(applySessionEvent, emptySessionState()).reasoning;
      return { modelRef, options, selected: saved && options.includes(saved) ? saved : null };
    }
    if (channel === "session.export") return { exported: true };
    if (channel === "artifacts.list")
      return row.artifacts.map(({ content: _, ...summary }) => structuredClone(summary));
    if (channel === "changes.list")
      return row.changes.map(({ diff: _, ...summary }) => structuredClone(summary));
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
    if (channel === "session.send" && row.active) {
      this.writable();
      if (row.stop || row.approval || !row.turnId) throw veraError("BUSY");
      if (!request.text.trim()) throw veraError("INVALID");
      const messageId = `message_${++this.number}`;
      this.emit(id, { type: "message.queued", messageId, text: request.text, timestamp: Date.now() });
      return { turnId: row.turnId, messageId };
    }
    this.idle(id);
    row.summary.updatedAt = new Date().toISOString();
    if (channel === "session.archive.set") {
      row.summary.archived = request.archived;
      this.emit(id, { type: "session.updated", status: row.summary.status });
      return row.summary;
    }
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
      const saved = row.events.reduce(applySessionEvent, emptySessionState()).reasoning;
      const model = request.modelRef ?? this.current().model;
      this.emit(id, {
        type: "session.updated",
        modelRef: request.modelRef,
        ...(saved && (!model || !this.reasoningLevels(model).includes(saved)) ? { reasoning: null } : {}),
      });
      return row.summary;
    }
    if (channel === "session.send") {
      const key = this.key(id);
      row.active = true;
      row.stop = false;
      const turnId = `turn_${++this.number}`,
        messageId = `message_${++this.number}`;
      row.turnId = turnId;
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
            if (outcome === "approved") {
              const change: ChangeDetail = {
                changeId: ++this.changeNumber,
                sessionId: id,
                path: "docs/notes/bringup.md",
                createdAt: new Date().toISOString(),
                added: 1,
                removed: 1,
                diff: "--- docs/notes/bringup.md\n+++ docs/notes/bringup.md\n@@ -1 +1 @@\n-old\n+new\n",
              };
              row.changes.push(change);
              this.emit(
                id,
                {
                  type: "change.recorded",
                  changeId: change.changeId,
                  path: change.path,
                  added: change.added,
                  removed: change.removed,
                },
                key,
              );
            }
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
          if (/^update the plan(?:\s|$)/i.test(request.text)) {
            for (const items of [
              [
                { id: "inspect", text: "Inspect the board", status: "in_progress" as const },
                { text: "Verify the pins", status: "pending" as const },
              ],
              [
                { text: "Verify the pins", status: "in_progress" as const },
                { id: "inspect", text: "Inspect the board", status: "done" as const },
              ],
              [{ id: "summary", text: "Board verification complete", status: "done" as const }],
            ]) {
              if (row.stop) break;
              this.emit(id, { type: "todo.updated", items }, key);
              await new Promise((done) => setTimeout(done, 300));
            }
          }
          if (!row.stop) {
            const pending = row.events
              .reduce(applySessionEvent, emptySessionState())
              .items.filter((item) => item.kind === "user" && item.pending);
            if (pending.length)
              this.emit(id, { type: "message.delivered", messageIds: pending.map((item) => item.id) }, key);
            if (/artifact/i.test(request.text)) {
              const artifact: ArtifactContent = {
                artifactId: `art_${String(++this.number).padStart(26, "0")}`,
                sessionId: id,
                name: "summary.md",
                mime: "text/markdown",
                bytes: 16,
                sha256: "a".repeat(64),
                description: "Mock summary",
                createdAt: new Date().toISOString(),
                content: "# Mock artifact\n",
              };
              row.artifacts.push(artifact);
              this.emit(
                id,
                {
                  type: "artifact.saved",
                  artifactId: artifact.artifactId,
                  name: artifact.name,
                  bytes: artifact.bytes,
                },
                key,
              );
            }
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
