import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AutoTokenizer } from "@huggingface/transformers";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { EmbeddingSwitchApproval, SessionEvent, VeraBridge } from "@vera/shared";
import Database from "better-sqlite3";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = resolve("src/apps/desktop");
const bge = "Xenova/bge-small-en-v1.5";
const e5 = "Xenova/multilingual-e5-small";
const dense = {
  [bge]: "QFN_2x2_0.4mm ".repeat(47),
  [e5]: "a ä ו я 功 ".repeat(100),
};
const multilingualDocs = {
  "ventilation.txt":
    "Aplicați ventilație forțată pentru a elimina vaporii inflamabili din încăpere. Deschideți gurile de aerisire înainte de a porni instalația.",
  "coolant.txt":
    "Bei zu niedrigem Kühlmittelstand wird die Kreiselpumpe automatisch abgeschaltet. Die Schutzschaltung verhindert dadurch einen Trockenlauf.",
};
const cases = [
  {
    name: "english",
    model: bge,
    docs: {
      "supply.txt": "The controller receives power from a rechargeable battery during a mains outage.",
      "clock.txt": "The real-time clock stores date and time using a quartz crystal.",
      ...multilingualDocs,
      "dense.txt": dense[bge],
    },
  },
  {
    name: "multilingual",
    model: e5,
    docs: {
      ...multilingualDocs,
      "dense.txt": dense[e5],
    },
  },
] as const;
const queries = [
  {
    name: "english-power",
    query: "What keeps the electronics running when the electricity fails?",
    path: "docs/supply.txt",
    mode: "semantic",
  },
  {
    name: "romanian",
    query: "Cum împiedic acumularea gazelor care pot lua foc într-un spațiu închis?",
    path: "docs/ventilation.txt",
    mode: "semantic",
  },
  {
    name: "german",
    query: "Wie wird das Förderaggregat geschützt, wenn zu wenig Flüssigkeit vorhanden ist?",
    path: "docs/coolant.txt",
    mode: "semantic",
  },
  {
    name: "english-air",
    query: "How do I prevent combustible fumes from accumulating indoors?",
    path: "docs/ventilation.txt",
    mode: "semantic",
  },
  {
    name: "english-coolant",
    query: "What protects the pump if the cooling liquid runs low?",
    path: "docs/coolant.txt",
    mode: "semantic",
  },
  { name: "keyword", query: "Trockenlauf", path: "docs/coolant.txt", mode: "keyword" },
] as const;

function search(page: Page, name: string) {
  return page.evaluate(async (name) => {
    const api = (window as unknown as { vera: VeraBridge }).vera;
    const session = await api.invoke("session.create", { modelRef: `replay/${name}` });
    const events: SessionEvent[] = [];
    const done = new Promise<void>((resolve) => {
      const off = api.subscribe("session", session.id, 0, (event) => {
        events.push(event);
        if (event.type === "turn.done") {
          off();
          resolve();
        }
      });
    });
    await api.invoke("session.send", { sessionId: session.id, text: "Search the workbench documents." });
    await done;
    const tool = events.find((event) => event.type === "tool.done");
    if (!tool) throw Error(JSON.stringify(events));
    const { snapshot } = await api.invoke("session.get", { sessionId: session.id });
    const item = snapshot.items.find((item) => item.kind === "tool" && item.id === tool.callId);
    return { tool, text: item?.kind === "tool" ? (item.preview ?? tool.summary) : tool.summary };
  }, name);
}

test("one native app session indexes and semantically searches two local embedding models", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vera-embedding-models-"));
  const replay = join(root, "replay");
  await mkdir(replay);
  for (const { name, query, mode } of queries) {
    await writeFile(
      join(replay, `${name}.jsonl`),
      [
        JSON.stringify({ toolCalls: [{ name: "search_docs", args: { query, mode, k: 1 } }] }),
        JSON.stringify({ text: "Search complete." }),
      ].join("\n"),
    );
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  env.VERA_REPLAY_DIR = replay;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${join(root, "data")}`],
    env,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as { vera?: VeraBridge }).vera);
    const bgeTokenizer = await AutoTokenizer.from_pretrained(resolve("src/models", bge), {
      local_files_only: true,
    });
    const e5Tokenizer = await AutoTokenizer.from_pretrained(resolve("src/models", e5), {
      local_files_only: true,
    });
    const count = {
      [bge]: (text: string) => bgeTokenizer.encode(text, { add_special_tokens: true }).length,
      [e5]: (text: string) => e5Tokenizer.encode(`passage: ${text}`, { add_special_tokens: true }).length,
    };
    for (const { name, model, docs } of cases) {
      const folder = join(root, name);
      await mkdir(join(folder, "docs"), { recursive: true });
      await page.evaluate(
        async ({ folder, name }) => {
          const api = (window as unknown as { vera: VeraBridge }).vera;
          await api.invoke("workbench.create", { folder, name });
          await api.invoke("workbench.close", {});
        },
        { folder, name },
      );
      if (model === e5) {
        const config = join(folder, ".vera/workbench.yaml");
        const yaml = await readFile(config, "utf8");
        expect(yaml).toContain(bge);
        await writeFile(config, yaml.replace(bge, e5));
      }
      for (const [file, text] of Object.entries(docs)) await writeFile(join(folder, "docs", file), text);
      const opened = await page.evaluate(
        async (folder) =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.open", { folder }),
        folder,
      );
      expect(opened.config.embeddings.model).toBe(model);
      await expect
        .poll(
          () =>
            page.evaluate(async (workbenchId) => {
              const api = (window as unknown as { vera: VeraBridge }).vera;
              return (await api.invoke("docs.list", { workbenchId })).documents.map(({ status }) => status);
            }, opened.config.id),
          { timeout: 55000 },
        )
        .toEqual(Object.keys(docs).map(() => "indexed"));

      const db = new Database(join(folder, ".vera/vera.db"), { readonly: true });
      try {
        const rows = db
          .prepare(`SELECT c.text, d.path, e.model_id FROM chunks c
          JOIN documents d ON d.id=c.doc_id LEFT JOIN embeddings e ON e.chunk_id=c.id`)
          .all() as { text: string; path: string; model_id: string }[];
        expect(rows.filter(({ path }) => path === "docs/dense.txt").length).toBeGreaterThan(1);
        expect(count[model](dense[model])).toBeGreaterThan(512);
        expect(count[model === e5 ? bge : e5](dense[model])).toBeLessThanOrEqual(512);
        for (const row of rows) {
          expect(row.model_id.startsWith(`${model}@`)).toBe(true);
          expect(count[model](row.text)).toBeLessThanOrEqual(512);
        }
      } finally {
        db.close();
      }

      const selected = queries.filter(({ name }) =>
        model === bge
          ? ["english-power", "english-coolant", "keyword"].includes(name)
          : name !== "english-power",
      );
      for (const { name, path } of selected) {
        const result = await search(page, name);
        expect(result.tool).toMatchObject({ ok: true });
        if (model === bge && name === "english-coolant") {
          expect(result.text).toContain("docs/");
          expect(result.text).not.toContain(path);
        } else {
          expect(result.text).toContain(path);
        }
        expect(result.text).not.toContain("unavailable");
      }
      await page.evaluate(async () =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.close", {}),
      );
    }
    await page.evaluate(
      async (folder) => (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.open", { folder }),
      join(root, "english"),
    );
    expect((await search(page, "english-power")).text).toContain("docs/supply.txt");
    const vectors = (name: string) => {
      const db = new Database(join(root, name, ".vera/vera.db"), { readonly: true });
      try {
        return db
          .prepare("SELECT chunk_id,model_id,hex(vector) AS bytes FROM embeddings ORDER BY chunk_id")
          .all();
      } finally {
        db.close();
      }
    };
    const original = vectors("english");
    const other = vectors("multilingual");
    await page.locator("[data-workbench-entry] .workbench-group-name").filter({ hasText: "english" }).click();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="embeddings"]').click();
    const model = page.locator(".workbench-editor").getByRole("combobox", { name: /Embedding model/ });
    await expect(model.locator("option")).toHaveText(
      ["BGE Small EN v1.5 (English)", "Multilingual E5 Small (100 languages)"],
      { timeout: 4000 },
    );
    await expect(model).toHaveValue(bge);
    const folder = join(root, "english");
    const yaml = await readFile(join(folder, ".vera/workbench.yaml"), "utf8");
    await model.selectOption(e5);
    const save = page.locator("[data-project-save]");
    await save.click();
    const confirmation = page.getByRole("dialog", { name: "Change embedding model?" });
    await expect(confirmation).toContainText("Indexed documents (5)");
    expect(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).toBe(yaml);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).toBe(yaml);
    expect(vectors("english")).toEqual(original);

    const rejected = await page.evaluate(
      async ({ next }) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        const { config } = await api.invoke("workbench.config.get", {});
        const errors: string[] = [];
        const approvals: (EmbeddingSwitchApproval | undefined)[] = [undefined, { from: next, count: 5 }];
        for (const embeddingSwitch of approvals) {
          try {
            await api.invoke("workbench.config.update", {
              workbenchId: config.id,
              patch: { embeddings: { ...config.embeddings, model: next } },
              ...(embeddingSwitch ? { embeddingSwitch } : {}),
            });
          } catch (error) {
            errors.push((error as { code: string }).code);
          }
        }
        return errors;
      },
      { next: e5 } as const,
    );
    expect(rejected).toEqual(["CONFLICT", "CONFLICT"]);
    expect(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).toBe(yaml);
    expect(vectors("english")).toEqual(original);

    const progress = await page.evaluateHandle(async (model) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const { config } = await api.invoke("workbench.config.get", {});
      const pending: number[] = [];
      let switched = false;
      const rebuild = { observed: false, searchable: null as number | null };
      const unsubscribe = api.subscribe("workbench", config.id, (event) => {
        if (event.type === "config.changed" && event.config.embeddings.model === model) switched = true;
        if (event.type === "index.status" && event.status.state === "rebuilding") {
          rebuild.observed = true;
          rebuild.searchable = event.status.searchable;
        }
        if (switched && event.type === "index.progress") {
          pending.push(event.pending);
          if (event.pending === 0) unsubscribe();
        }
      });
      return { pending, rebuild };
    }, e5);
    await save.click();
    await expect(confirmation).toContainText("Indexed documents (5)");
    await writeFile(join(folder, "docs/cabinet.txt"), "Cabinet dimensions are recorded separately.");
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const api = (window as unknown as { vera: VeraBridge }).vera;
            const { config } = await api.invoke("workbench.config.get", {});
            const { documents } = await api.invoke("docs.list", { workbenchId: config.id });
            return documents.filter(({ status }) => status === "indexed").length;
          }),
        { timeout: 30000 },
      )
      .toBe(6);
    await confirmation.getByRole("button", { name: "Change model", exact: true }).click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    await expect
      .poll(() => progress.evaluate(({ pending }) => pending), { timeout: 55000 })
      .toEqual([6, 5, 4, 3, 2, 1, 0]);
    expect(await progress.evaluate(({ rebuild }) => rebuild)).toEqual({ observed: true, searchable: 6 });
    await progress.dispose();
    await expect
      .poll(
        () => {
          const db = new Database(join(folder, ".vera/vera.db"), { readonly: true });
          try {
            return db
              .prepare(`SELECT count(*) FROM chunks c LEFT JOIN embeddings e ON e.chunk_id=c.id
          WHERE e.model_id IS NULL OR e.model_id NOT LIKE ?`)
              .pluck()
              .get(`${e5}@%`);
          } finally {
            db.close();
          }
        },
        { timeout: 55000 },
      )
      .toBe(0);
    expect(vectors("english").length).toBeGreaterThan(0);
    expect(vectors("multilingual")).toEqual(other);
    expect(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).toContain(e5);
    const result = await search(page, "romanian");
    expect(result.tool).toMatchObject({ ok: true });
    expect(result.text).toContain("docs/ventilation.txt");
    expect(result.text).not.toContain("keyword results");
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
