// Metric series shaped like P1's datasets. Offsets are seconds from the test-run start.
import { rng } from "./clock";

export interface OffsetPoint {
  offset: number;
  value: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** iperf3 1 s intervals; `flap` zeroes seconds 14–15 and ramps back (02 switch-flap), scaled so the mean hits `target`. */
export function perfSeries(target: number, seed: number, flap = false): OffsetPoint[] {
  const r = rng(seed);
  const ramp: Record<number, number> = { 14: 0, 15: 0, 16: 0.6, 17: 0.85, 18: 0.95, 19: 0.99 };
  const shape = Array.from({ length: 30 }, (_, i) => (flap && i in ramp ? ramp[i]! : 1) * (1 + (r() - 0.5) * 0.008));
  const scale = target / mean(shape);
  return shape.map((v, i) => ({ offset: i + 1, value: Math.min(941.5, Math.round(v * scale * 10) / 10) }));
}

/** healthmon every 300 s from uptime 10.9 s, 145 points (kB). `leak` = −17.5 MB/h with OOM + respawn at 9 h 40 m 12 s. */
export function memSeries(seed: number, leak: boolean): OffsetPoint[] {
  const r = rng(seed);
  const oom = 34812;
  return Array.from({ length: 145 }, (_, k) => {
    const t = 10.9 + 300 * k;
    const h = t / 3600;
    const noise = (r() - 0.5) * 2400;
    let mb: number;
    if (!leak) mb = 183 + 0.015 * h + Math.sin(k / 7) * 1.2;
    else if (t < oom) mb = 176 - 17.5 * h;
    else mb = 176 - 17.5 * ((t - oom - 5.4) / 3600);
    return { offset: Math.round(t * 10) / 10, value: Math.max(4000, Math.round(mb * 1000 + noise)) };
  });
}

/** iperf3-series: one 10 s burst every 30 min, 24 entries. 2.1.0 dips to 611.5 Mbps at 9.5 h (memory pressure). */
export function enduranceTput(seed: number, leak: boolean): OffsetPoint[] {
  const r = rng(seed);
  return Array.from({ length: 24 }, (_, i) => {
    const base = leak && i === 19 ? 611.5 : 928 + (r() - 0.5) * 8;
    return { offset: i * 1800 + 10, value: Math.max(leak ? 0 : 924, Math.round(base * 10) / 10) };
  });
}

/**
 * 200 DNS response times (ms) over 60 s. 140 cache hits ≈ 1 ms, 60 misses forwarded upstream.
 * Miss latencies are spread so the nearest-rank p95 (rank 190) equals `p95`.
 */
export function dnsSeries(p95: number, seed: number): OffsetPoint[] {
  const r = rng(seed);
  const lo = 24;
  // Sorted misses m1…m60; overall rank 190 = 140 hits + m50.
  const hi = lo + ((p95 - lo) * 59) / 49;
  const misses = Array.from({ length: 60 }, (_, i) => Math.round((lo + ((hi - lo) * i) / 59) * 100) / 100);
  const hits = Array.from({ length: 140 }, () => Math.round((0.6 + r() * 0.9) * 100) / 100);
  const all = [...hits, ...misses];
  // Deterministic shuffle so misses are spread over the run.
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  return all.map((value, i) => ({ offset: Math.round(i * 0.3 * 10) / 10, value }));
}

export function p95Of(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1] ?? 0;
}

/** Least-squares slope in value units per hour. */
export function slopePerHour(points: OffsetPoint[]): number {
  const n = points.length;
  if (n < 2) return 0;
  const mx = mean(points.map((p) => p.offset));
  const my = mean(points.map((p) => p.value));
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.offset - mx) * (p.value - my);
    den += (p.offset - mx) ** 2;
  }
  return den ? (num / den) * 3600 : 0;
}
