// Data-clock helpers for fixtures. Times follow P1's generated datasets (docs/progress/P1.md):
// live 2.1.0 block starts 2026-10-07T21:00Z (PERF, DNS, END), then 2026-10-08T09:18Z (DHCP, IPv6, PERF re-run).

export const at = (iso: string): number => Date.parse(iso) / 1000;

/** Deterministic PRNG (Park–Miller), same as the mockup's. */
export function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** OpenWrt logread prefix: `Thu Oct  8 06:52:12 2026`. */
export function logreadTime(ts: number): string {
  const d = new Date(ts * 1000);
  const day = String(d.getUTCDate()).padStart(2, " ");
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${day} ${d.toISOString().slice(11, 19)} ${d.getUTCFullYear()}`;
}

/** IOS-style syslog prefix: `Oct  7 21:00:14`. */
export function iosTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${d.toISOString().slice(11, 19)}`;
}

export const iso = (ts: number) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
