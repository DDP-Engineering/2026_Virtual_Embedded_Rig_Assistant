import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

for (const aboutPlan of [false, true])
  test(
    aboutPlan
      ? "a pending plan decision survives reload and Activity opens the correct Plan"
      : "a background question survives unavailable native delivery and reload, and Activity focuses its card",
    async () => {
      test.setTimeout(120_000);
      const root = await mkdtemp(join(tmpdir(), "vera-session-question-"));
      const a = join(root, "a");
      const b = join(root, "b");
      const scripts = join(root, "scripts");
      for (const directory of [a, b, scripts]) await mkdir(directory);
      await writeFile(
        join(scripts, "question.jsonl"),
        [
          ...(aboutPlan
            ? [
                {
                  toolCalls: [
                    { name: "todo", args: { items: [{ text: "Inspect the board", status: "pending" }] } },
                  ],
                },
              ]
            : []),
          {
            toolCalls: [
              {
                name: "ask_user",
                args: {
                  question: "Which profile?",
                  choices: ["Quiet", "Fast"],
                  recommended: 2,
                  ...(aboutPlan && { aboutPlan }),
                },
              },
            ],
          },
          ...(aboutPlan ? [{ toolCalls: [{ name: "todo", args: { items: [] } }] }] : []),
          { text: "Received {{source}}: {{answer}}" },
        ]
          .map((step) => JSON.stringify(step))
          .join("\n"),
      );
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      delete env.ELECTRON_RUN_AS_NODE;
      env.VERA_REPLAY_DIR = scripts;
      const app = await _electron.launch({
        executablePath: resolve(
          "node_modules/electron/dist",
          process.platform === "win32" ? "electron.exe" : "electron",
        ),
        args: [
          env.VERA_BUILD_ROOT ? resolve(env.VERA_BUILD_ROOT, "main/index.js") : resolve("src/apps/desktop"),
          `--user-data-dir=${join(root, "profile")}`,
        ],
        env,
      });
      try {
        await installNetworkGuard(app);
        await app.evaluate(({ Notification }) => {
          Object.assign(globalThis, { questionNativeProbes: 0 });
          Notification.isSupported = () => {
            (globalThis as unknown as { questionNativeProbes: number }).questionNativeProbes++;
            return false;
          };
        });
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
        await call("app.settings.update", {
          language: "en",
          notifications: { turnCompletion: "never", approvalRequests: false },
        });
        const benchA = await call("workbench.create", { folder: a, name: "Question bench" });
        expect(benchA.config.agent.question_timeout_minutes ?? null).toBeNull();
        await call("workbench.config.update", {
          workbenchId: benchA.config.id,
          patch: {
            agent: { question_timeout_minutes: 15 },
            ...(aboutPlan && { chat: { detail: "minimal" }, interface: { right_panel_tabs: ["docs"] } }),
          },
        });
        const session = await call("session.create", {
          workbenchId: benchA.config.id,
          modelRef: "replay/question",
        });
        const get = () => call("session.get", { sessionId: session.id });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());
        await expect
          .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized()))
          .toBe(true);
        // Driving a minimized renderer can restore its OS focus before the pending event arrives.
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          if (window) window.isFocused = () => false;
        });
        await call("session.send", { sessionId: session.id, text: "Ask about a profile" });
        await expect.poll(async () => (await get()).snapshot.questions[0]?.outcome).toBeNull();
        const probes = () =>
          app.evaluate(
            () => (globalThis as unknown as { questionNativeProbes: number }).questionNativeProbes,
          );
        await expect.poll(probes).toBe(1);
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          if (!window) return;
          window.isFocused = BrowserWindow.prototype.isFocused.bind(window);
          window.restore();
        });
        const question = (await get()).snapshot.questions[0];
        if (!question) throw new Error("Question missing");
        expect(question.deadline).not.toBeNull();
        await call("app.settings.update", { notifications: { questionRequests: false } });
        expect((await get()).snapshot.questions[0]).toEqual(question);
        const benchB = await call("workbench.create", { folder: b, name: "Other bench" });
        expect(benchB.config.agent.question_timeout_minutes ?? null).toBeNull();
        await page.reload();
        expect(await probes()).toBe(1);
        const wrongOwner = await page.evaluate(
          async (request) => {
            try {
              await (window as unknown as { vera: VeraBridge }).vera.invoke(
                "session.question.answer",
                request,
              );
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
        const trigger = page.getByRole("button", { name: "Activity", exact: true });
        const view = page.getByRole("dialog", { name: "Activity" });
        const entry = view.locator(
          aboutPlan ? '[data-activity-kind="plan"]' : '[data-activity-kind="question"]',
        );
        await trigger.press("Enter");
        await expect(
          view.getByRole("heading", { name: aboutPlan ? "Plans awaiting a decision" : "Needs answer" }),
        ).toBeVisible();
        await expect(entry).toContainText("Question bench");
        await entry.press("Enter");
        const card = page.getByRole("region", { name: "Which profile?" });
        if (aboutPlan) {
          await expect(page.locator("#panel-plan")).toContainText("Inspect the board");
          await expect(page.locator("[data-plan-available]")).toContainText("Plan available · 1 step");
          await page.locator('[data-toggle="right"]').click();
          await page.getByRole("button", { name: "Open plan", exact: true }).click();
          await expect(page.locator("#panel-plan")).toContainText("Inspect the board");
        } else {
          await expect(card).toBeFocused();
        }
        await expect(card.getByText(/Recommended answer applies at/)).toBeVisible();
        await card.getByRole("radio", { name: "Fast Recommended" }).check();
        expect((await get()).snapshot.questions[0]?.outcome).toBeNull();
        await card.getByRole("button", { name: "Submit answer" }).click();
        await expect(card.getByText("User answer: Fast")).toBeVisible();
        await expect(page.getByText("Received user: Fast")).toBeVisible();
        await expect.poll(async () => (await get()).snapshot.activeTurnId).toBeNull();
        if (aboutPlan) await expect(page.locator("[data-plan-available]")).toHaveCount(0);
        await trigger.press("Enter");
        await expect(entry).toHaveCount(0);
        await expect(view.getByRole("heading", { name: "Unread completions" })).toBeVisible();
        await page.keyboard.press("Escape");
        await call("workbench.close", {});
        expect((await call("workbench.open", { folder: a })).config.agent.question_timeout_minutes).toBe(15);
        expect(
          (await call("workbench.open", { folder: b })).config.agent.question_timeout_minutes ?? null,
        ).toBeNull();
        expect(await probes()).toBe(1);
        expect(await outboundAttempts(app)).toEqual([]);
      } finally {
        try {
          await app.close();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  );
