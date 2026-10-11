export interface LineRef {
  path: string;
  start: number;
  end: number;
}
function valid(value: LineRef): boolean {
  return (
    !!value.path &&
    !/[\0\\:]/.test(value.path) &&
    !value.path.startsWith("/") &&
    !value.path.split("/").some((segment) => segment === ".." || segment === "." || !segment) &&
    Number.isSafeInteger(value.start) &&
    Number.isSafeInteger(value.end) &&
    value.start >= 1 &&
    value.end >= value.start
  );
}
export function formatLineRef(value: LineRef): string {
  if (!valid(value)) throw Error("Invalid line reference.");
  return `${value.path}#L${value.start}-L${value.end}`;
}
export function parseLineRef(text: string): LineRef | undefined {
  const match = /^(.*)#L([1-9]\d*)-L([1-9]\d*)$/.exec(text);
  if (!match) return undefined;
  const value = { path: match[1] ?? "", start: Number(match[2]), end: Number(match[3]) };
  return valid(value) ? value : undefined;
}
