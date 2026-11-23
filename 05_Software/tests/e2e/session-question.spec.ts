import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("a background question survives renderer reload and its activity entry focuses the originating card", async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), "vera-session-question-"));
  const a = join(root, "a");
  const b = join(root, "b");
  const scripts = join(root, "scripts");
  for (const directory of [a, b, scripts]) await mkdir(directory);
  await writeFile(
    join(scripts, "question.jsonl"),
    [
      {
        toolCalls: [
          {
            name: "ask_user",
            args: { question: "Which profile?", choices: ["Quiet", "Fast"], recommended: 2 },
          },
        ],
      },
      { text: "Received {{source}}: {{answer}}" },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
    env,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    const call = <C extends Channel>(channel: C, payload: Request<C>) =>
      page.evaluate(
        ([name, request]) => {
          const { vera } = window as unknown as {
            vera: { invoke(name: string, request: unknown): Promise<unknown> };
          };
          return vera.invoke(name, request);
        },
        [channel, payload] as const,
      ) as Promise<Response<C>>;
    await call("app.settings.update", { language: "en" });
    const benchA = await call("workbench.create", { folder: a, name: "Question bench" });
    expect(benchA.config.agent.question_timeout_minutes ?? null).toBeNull();
    await call("workbench.config.update", {
      workbenchId: benchA.config.id,
      patch: { agent: { question_timeout_minutes: 15 } },
    });
    const session = await call("session.create", {
      workbenchId: benchA.config.id,
      modelRef: "replay/question",
    });
    const get = () => call("session.get", { sessionId: session.id });
    await call("session.send", { sessionId: session.id, text: "Ask about a profile" });
    await expect.poll(async () => (await get()).snapshot.questions[0]?.outcome).toBeNull();
    const question = (await get()).snapshot.questions[0];
    if (!question) throw new Error("Question missing");
    expect(question.deadline).not.toBeNull();
    const benchB = await call("workbench.create", { folder: b, name: "Other bench" });
    expect(benchB.config.agent.question_timeout_minutes ?? null).toBeNull();
    await page.reload();
    const wrongOwner = await page.evaluate(
      async (request) => {
        try {
          await (window as unknown as { vera: VeraBridge }).vera.invoke("session.question.answer", request);
        } catch (error) {
          return error;
        }
      },
      {
        sessionId: session.id,
        workbenchId: benchB.config.id,
        questionId: question.questionId,
        reply: { kind: "cancel" as const },
      },
    );
    expect(wrongOwner).toMatchObject({ code: "CONFLICT" });
    const activity = page.locator(`[data-workbench-entry="${benchA.config.id}"] .workbench-activity`);
    await expect(activity).toHaveAttribute("data-activity", "awaiting_question");
    await expect.poll(async () => (await get()).snapshot.questions[0]).toEqual(question);
    await activity.locator("summary").click();
    await activity.getByRole("button", { name: /Awaiting an answer/ }).click();
    const card = page.getByRole("region", { name: "Which profile?" });
    await expect(card).toBeFocused();
    await expect(card.getByText(/Recommended answer applies at/)).toBeVisible();
    await card.getByRole("radio", { name: "Fast Recommended" }).check();
    expect((await get()).snapshot.questions[0]?.outcome).toBeNull();
    await card.getByRole("button", { name: "Submit answer" }).click();
    await expect(card.getByText("User answer: Fast")).toBeVisible();
    await expect(page.getByText("Received user: Fast")).toBeVisible();
    await expect.poll(async () => (await get()).snapshot.activeTurnId).toBeNull();
    await call("workbench.close", {});
    expect((await call("workbench.open", { folder: a })).config.agent.question_timeout_minutes).toBe(15);
    expect(
      (await call("workbench.open", { folder: b })).config.agent.question_timeout_minutes ?? null,
    ).toBeNull();
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    try {
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
