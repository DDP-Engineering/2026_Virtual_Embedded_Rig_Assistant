// REQ-UX-41da0f4f REQ-UX-85399085 REQ-UX-2697c05c REQ-UX-b99b1695
import type { CatalogActivity, CatalogPlugin, PluginProgramStatus, PluginSummary } from "@vera/shared";

export type LibraryTab = "available" | "installed";
export type LibraryStatus = "all" | "missing" | "installed" | "new" | "updates" | "needs";
export interface LibraryState {
  tab: LibraryTab;
  search: string;
  ecosystem: string;
  activity: string;
  tier: string;
  status: LibraryStatus;
  sort: "added" | "updated" | "name";
  page: number;
  pageSize: 6 | 12 | 24;
}
export const initialLibraryState: LibraryState = {
  tab: "available",
  search: "",
  ecosystem: "",
  activity: "",
  tier: "",
  status: "all",
  sort: "added",
  page: 1,
  pageSize: 6,
};
export const libraryStateKey = ["ui", "plugin-library"] as const;
export const pluginProgramsKey = (workbenchId: string | undefined, plugin: PluginSummary) =>
  ["plugin-programs", workbenchId ?? null, plugin.id, plugin.sha256, plugin.installedAt] as const;
export type ProgramReadiness = "unchecked" | "ready" | "needs" | "unavailable";
export function programReadiness(
  plugin: PluginSummary,
  observations?: readonly PluginProgramStatus[],
  failed = false,
): ProgramReadiness {
  if (failed || plugin.issues.length) return "unavailable";
  if (!observations) return "unchecked";
  if (observations.some((program) => program.state === "unavailable")) return "unavailable";
  return observations.every((program) => program.state === "ready") ? "ready" : "needs";
}
export interface LibraryItem {
  key: string;
  id: string;
  name: string;
  description: string;
  ecosystem: string;
  tier: string;
  source: string;
  activities: readonly CatalogActivity[];
  keywords: readonly string[];
  addedAt?: string | undefined;
  updatedAt?: string | undefined;
  installed: boolean;
  update: boolean;
  readiness: ProgramReadiness;
  catalog?: CatalogPlugin | undefined;
  plugin?: PluginSummary | undefined;
}
export function catalogLibraryItems(entries: readonly CatalogPlugin[]): LibraryItem[] {
  return entries.map((entry) => ({
    key: `catalog/${entry.id}`,
    id: entry.id,
    name: entry.name,
    description: entry.description,
    ecosystem: entry.ecosystem,
    tier: entry.tier,
    source: "catalog",
    activities: entry.activities,
    keywords: entry.keywords,
    addedAt: entry.addedAt,
    updatedAt: entry.updatedAt,
    installed: Boolean(entry.installed),
    update: entry.update,
    readiness: "unchecked",
    catalog: entry,
  }));
}
export function installedLibraryItems(
  plugins: readonly PluginSummary[],
  entries: readonly CatalogPlugin[],
  observations: (plugin: PluginSummary) => readonly PluginProgramStatus[] | undefined,
  failed: (plugin: PluginSummary) => boolean = () => false,
): LibraryItem[] {
  const catalog = new Map(entries.map((entry) => [entry.id, entry]));
  return plugins.map((plugin) => {
    // Local/trial/scoped packages never borrow catalog trust or chronology from an id coincidence.
    const published = catalog.get(plugin.id);
    const entry = plugin.source === "catalog" ? published : undefined;
    // Catalog tracks all global installations. A manual import keeps its source/tier until review.
    const update =
      plugin.source !== "workbench" &&
      Boolean(published?.update && published.installed && published.installed.version === plugin.version);
    return {
      key: `${plugin.source ?? "unknown"}/${plugin.id}/${plugin.sha256 ?? ""}/${plugin.installedAt ?? ""}`,
      id: plugin.id,
      name: plugin.name ?? plugin.id,
      description: plugin.description ?? "",
      ecosystem: plugin.ecosystem ?? "",
      tier: plugin.tier ?? "",
      source: plugin.source ?? "",
      activities: entry?.activities ?? [],
      keywords: entry?.keywords ?? [],
      addedAt: entry?.addedAt,
      updatedAt: entry?.updatedAt,
      installed: true,
      update,
      readiness: programReadiness(plugin, observations(plugin), failed(plugin)),
      plugin,
      catalog: entry,
    };
  });
}
export const normalizeLibraryText = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export function isNewCatalogEntry(addedAt: string | undefined, now = Date.now()): boolean {
  if (!addedAt) return false;
  const day = Math.floor(now / 86_400_000);
  const age = day - Math.floor(Date.parse(`${addedAt}T00:00:00Z`) / 86_400_000);
  return age >= 0 && age < 30;
}
export function matchesLibraryStatus(item: LibraryItem, status: LibraryStatus, now = Date.now()): boolean {
  if (status === "missing") return !item.installed;
  if (status === "installed") return item.installed;
  if (status === "updates") return item.update;
  if (status === "new") return isNewCatalogEntry(item.addedAt, now);
  if (status === "needs") return item.readiness === "needs";
  return true;
}
export function matchesLibraryFilters(
  item: LibraryItem,
  state: LibraryState,
  activityLabels: Record<CatalogActivity, string>,
): boolean {
  const text = normalizeLibraryText(
    [
      item.id,
      item.name,
      item.description,
      item.ecosystem,
      ...item.activities.map((activity) => activityLabels[activity]),
      ...item.keywords,
    ].join(" "),
  );
  return (
    normalizeLibraryText(state.search)
      .split(/\s+/u)
      .filter(Boolean)
      .every((word) => text.includes(word)) &&
    (!state.ecosystem || item.ecosystem === state.ecosystem) &&
    (!state.activity || item.activities.includes(state.activity as CatalogActivity)) &&
    (!state.tier || item.tier === state.tier)
  );
}
export function sortLibraryItems(
  items: readonly LibraryItem[],
  sort: LibraryState["sort"],
  language: string,
): LibraryItem[] {
  const collator = new Intl.Collator(language, { sensitivity: "base" });
  const tie = (left: LibraryItem, right: LibraryItem) =>
    collator.compare(left.name, right.name) ||
    left.id.localeCompare(right.id) ||
    left.source.localeCompare(right.source) ||
    left.key.localeCompare(right.key);
  return [...items].sort((left, right) => {
    if (sort === "name") return tie(left, right);
    const a = sort === "added" ? left.addedAt : left.updatedAt;
    const b = sort === "added" ? right.addedAt : right.updatedAt;
    if (!a || !b) return a ? -1 : b ? 1 : tie(left, right);
    return b.localeCompare(a) || tie(left, right);
  });
}
