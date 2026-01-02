// lib/risk.ts
export type SeriesPoint = { date: string; value: number | null };
export type ReturnPoint = { date: string; r: number };

function safe(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function dailyReturns(series: SeriesPoint[]): ReturnPoint[] {
  const out: ReturnPoint[] = [];
  const s = series
    .map((p) => ({ date: p.date, value: safe(p.value) }))
    .filter((p) => p.value !== null) as { date: string; value: number }[];

  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1].value;
    const cur = s[i].value;
    if (prev <= 0) continue;
    const r = cur / prev - 1;
    if (Number.isFinite(r)) out.push({ date: s[i].date, r });
  }
  return out;
}

export function annualizedVolatility(returns: number[], periodsPerYear = 252): number | null {
  if (returns.length < 10) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const varSum = returns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0);
  const variance = varSum / (returns.length - 1);
  const stdev = Math.sqrt(Math.max(variance, 0));

  return stdev * Math.sqrt(periodsPerYear); // fraction
}

export function maxDrawdown(series: SeriesPoint[]): number | null {
  const vals = series
    .map((p) => safe(p.value))
    .filter((v): v is number => v !== null);

  if (vals.length < 2) return null;

  let peak = vals[0];
  let mdd = 0;

  for (const v of vals) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (v - peak) / peak : 0; // negative
    if (dd < mdd) mdd = dd;
  }

  return mdd; // negative fraction (e.g., -0.24)
}

/**
 * Original beta: assumes the two arrays are already aligned by time/index.
 * Kept for backward compatibility.
 */
export function beta(portReturns: number[], benchReturns: number[]): number | null {
  const n = Math.min(portReturns.length, benchReturns.length);
  if (n < 10) return null;

  const p = portReturns.slice(-n);
  const b = benchReturns.slice(-n);

  const meanP = p.reduce((a, x) => a + x, 0) / n;
  const meanB = b.reduce((a, x) => a + x, 0) / n;

  let cov = 0;
  let varB = 0;

  for (let i = 0; i < n; i++) {
    cov += (p[i] - meanP) * (b[i] - meanB);
    varB += (b[i] - meanB) * (b[i] - meanB);
  }

  cov /= n - 1;
  varB /= n - 1;

  if (varB === 0) return null;
  return cov / varB;
}

/**
 * Align two dated return series by date intersection (exact date string match).
 * Returns aligned arrays and sample count.
 */
export function alignReturnSeriesByDate(port: ReturnPoint[], bench: ReturnPoint[]) {
  const benchMap = new Map<string, number>();
  for (const b of bench) benchMap.set(b.date, b.r);

  const p: number[] = [];
  const b: number[] = [];

  for (const pr of port) {
    const br = benchMap.get(pr.date);
    if (typeof br === "number" && Number.isFinite(br) && Number.isFinite(pr.r)) {
      p.push(pr.r);
      b.push(br);
    }
  }

  return { port: p, bench: b, n: Math.min(p.length, b.length) };
}

/**
 * Date-aligned beta from dated return series.
 * Returns both beta and the number of aligned samples used.
 */
export function betaFromReturnSeries(
  port: ReturnPoint[],
  bench: ReturnPoint[],
  minSamples = 20
): { beta: number | null; n: number } {
  const { port: pAll, bench: bAll, n } = alignReturnSeriesByDate(port, bench);
  if (n < minSamples) return { beta: null, n };

  const p = pAll.slice(-n);
  const b = bAll.slice(-n);

  const meanP = p.reduce((a, x) => a + x, 0) / n;
  const meanB = b.reduce((a, x) => a + x, 0) / n;

  let cov = 0;
  let varB = 0;

  for (let i = 0; i < n; i++) {
    cov += (p[i] - meanP) * (b[i] - meanB);
    varB += (b[i] - meanB) * (b[i] - meanB);
  }

  cov /= n - 1;
  varB /= n - 1;

  if (varB === 0) return { beta: null, n };
  return { beta: cov / varB, n };
}
