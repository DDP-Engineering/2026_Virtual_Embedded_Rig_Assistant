// REQ-SEC-17075aa1; authored native port scenarios, execution deferred.
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionService } from "@vera/core";
import { sessionExportSchema } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { exportSession } from "./session-export.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const id = "ses_00000000000000000000000001";
const data = sessionExportSchema.parse({
  schemaVersion: 1,
  session: {
    id,
    title: "secret",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    modelRef: null,
    mode: "read-only",
    status: "idle",
    archived: false,
  },
  events: [
    {
      seq: 1,
      createdAt: null,
      event: { type: "message.user", messageId: "u", text: "secret", images: ["photos/secret.jpeg"] },
    },
    {
      seq: 2,
      createdAt: null,
      event: {
        type: "message.queued",
        messageId: "q",
        text: "secret",
        timestamp: 1,
        images: ["captures/secret.png"],
      },
    },
    {
      seq: 3,
      createdAt: null,
      event: { type: "tool.started", callId: "c", name: "read", args: { secret: "secret" } },
    },
    {
      seq: 4,
      createdAt: null,
      event: {
        type: "message.done",
        messageId: "a",
        text: "secret",
        citations: [{ ref: "secret#L1", valid: false }],
      },
    },
  ],
});
const service = {
  get: vi.fn(),
  exportSession: () => data,
  listChanges: () => [{ changeId: 1 }],
  getChange: () => ({ changeId: 1, path: "secret", diff: "+secret", added: 1, removed: 0 }),
} as unknown as SessionService;

it("cancels without writing; snapshots after picker and redacts structured JSON and Markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-session-export-"));
  roots.push(root);
  await mkdir(join(root, ".vera"));
  const write = vi.fn(async (_path: string, _content: string) => {});
  const scrub = (s: string) => s.replaceAll("secret", "[REDACTED]");
  expect(await exportSession(service, id, "md", { root, choose: async () => null, write, scrub })).toEqual({
    exported: false,
  });
  expect(write).not.toHaveBeenCalled();
  for (const format of ["json", "md"] as const) {
    expect(
      await exportSession(service, id, format, {
        root,
        choose: async (name) => {
          expect(name).toBe(`${id}.${format}`);
          return join(root, name);
        },
        write,
        scrub,
      }),
    ).toEqual({ exported: true });
    const content = write.mock.calls.at(-1)?.[1];
    expect(content).not.toContain("secret");
    if (format === "json") {
      const result = sessionExportSchema.parse(JSON.parse(String(content)));
      expect(result.events[0]?.event).toMatchObject({
        type: "message.user",
        messageId: "u",
        images: ["photos/[REDACTED].jpeg"],
      });
      expect(result.events[1]?.event).toMatchObject({
        type: "message.queued",
        messageId: "q",
        text: "[REDACTED]",
        images: ["captures/[REDACTED].png"],
      });
      expect(result.events[2]?.event).toMatchObject({ args: { "[REDACTED]": "[REDACTED]" } });
    } else {
      expect(content).toContain("+[REDACTED]");
      expect(content).toContain("captures/[REDACTED].png");
      expect(content).toContain("photos/[REDACTED].jpeg");
    }
  }
});

it("rejects relative and managed runtime destinations including junctions", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-session-export-"));
  roots.push(root);
  await mkdir(join(root, ".vera"));
  await symlink(join(root, ".vera"), join(root, "alias"), "junction");
  const write = vi.fn(async (_path: string, _content: string) => {});
  for (const target of ["relative.md", join(root, ".vera/session.json"), join(root, "alias/session.md")]) {
    await expect(
      exportSession(service, id, "md", { root, choose: async () => target, write, scrub: (s) => s }),
    ).rejects.toMatchObject({ code: target === "relative.md" ? "INVALID" : "DENIED" });
  }
  expect(write).not.toHaveBeenCalled();
});

it.each(["json", "md"] as const)(
  "resolves exports after the picker independently of retained agent history in %s",
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), "vera-mask04-export-"));
    roots.push(root);
    await mkdir(join(root, ".vera"));
    let mask = true;
    const write = vi.fn(async (_path: string, _content: string) => {});
    const scrub = (text: string) => text.replaceAll("secret", "[REDACTED]");
    for (const choice of [false, true]) {
      await exportSession(service, id, format, {
        root,
        write,
        scrub,
        masking: () => mask,
        choose: async () => {
          mask = choice;
          return join(root, `out.${format}`);
        },
      });
      expect(write.mock.calls.at(-1)?.[1].includes("secret")).toBe(!choice);
    }
  },
);
