// plans (01 data model; 04 §4 approval flow). The runner refuses any plan that is not `approved`.
import type { Plan, PlanItem, PlanStatus } from "@benchpilot/shared";
import type { Db } from "../index.ts";
import { nextId } from "./counters.ts";

interface PlanRow {
  id: string;
  session_id: string | null;
  testbench_id: string;
  title: string;
  device: string;
  fw: string;
  items_json: string;
  rationale: string;
  status: PlanStatus;
  comment: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface NewPlan {
  sessionId: string | null;
  testbenchId: string;
  title: string;
  device: string;
  fw: string;
  items: PlanItem[];
  rationale: string;
}

export function createPlan(db: Db, p: NewPlan, now = new Date()): Plan {
  const id = nextId(db, "PLAN");
  db.prepare(
    `INSERT INTO plans(id, session_id, testbench_id, title, device, fw, items_json, rationale, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(id, p.sessionId, p.testbenchId, p.title, p.device, p.fw, JSON.stringify(p.items), p.rationale, now.toISOString());
  return getPlan(db, id)!;
}

export function getPlan(db: Db, id: string): Plan | null {
  const r = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
  if (!r) return null;
  return {
    id: r.id,
    // CLI plans have no session (domain Plan.sessionId is a string; "" = none).
    sessionId: r.session_id ?? "",
    testbenchId: r.testbench_id,
    title: r.title,
    device: r.device,
    fw: r.fw,
    items: JSON.parse(r.items_json) as PlanItem[],
    rationale: r.rationale,
    status: r.status,
    ...(r.decided_at ? { decidedAt: r.decided_at } : {}),
    ...(r.comment ? { comment: r.comment } : {}),
  };
}

/** pending → approved | rejected. Optional edited items / firmware replace the proposal (01 plan decision). */
export function decidePlan(
  db: Db,
  id: string,
  d: { decision: "approve" | "reject"; items?: PlanItem[]; fw?: string; comment?: string },
  now = new Date(),
): Plan {
  const plan = getPlan(db, id);
  if (!plan) throw new Error(`plan ${id} not found`);
  if (plan.status !== "pending") throw new Error(`plan ${id} is ${plan.status}, not pending`);
  db.prepare("UPDATE plans SET status = ?, items_json = ?, fw = ?, comment = ?, decided_at = ? WHERE id = ?").run(
    d.decision === "approve" ? "approved" : "rejected",
    JSON.stringify(d.items ?? plan.items),
    d.fw ?? plan.fw,
    d.comment ?? null,
    now.toISOString(),
    id,
  );
  return getPlan(db, id)!;
}

/** Atomic status transition; false when the plan was not in `from` (e.g. a second run of the same plan). */
export function transitionPlan(db: Db, id: string, from: PlanStatus, to: PlanStatus): boolean {
  return db.prepare("UPDATE plans SET status = ? WHERE id = ? AND status = ?").run(to, id, from).changes === 1;
}
