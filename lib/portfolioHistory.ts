import type { Position, UserProfile } from "./types";

type Interval = "1d" | "1wk" | "1mo";

type HistoryPoint = {
  date: string; // YYYY-MM-DD
  close: number;
};

type HistoryResponse = {
  tickers: string[];
  interval: Interval;
  start?: string;
  end?: string;
  data: Record<string, HistoryPoint[]>;
};

function isISODate(s?: string): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function minDate(a?: string, b?: string): string | undefined {
  if (!isISODate(a)) return isISODate(b) ? b : undefined;
  if (!isISODate(b)) return a;
  return a <= b ? a : b;
}

function maxDate(a?: string, b?: string): string | undefined {
  if (!isISODate(a)) return isISODate(b) ? b : undefined;
  if (!isISODate(b)) return a;
  return a >= b ? a : b;
}

function toNumber(x: unknown, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Returns a portfolio value time series using historical closes since purchase date.
 * - For each position, uses quantity * close on each date
 * - CASH / Money Market is treated as constant balance across time (no interest modeled yet)
 */
export async function fetchPortfolioSeries(opts: {
  positions: Position[];
  profile: UserProfile | null;
  interval: Interval;
}): Promise<{ date: string; value: number }[]> {
  const { positions, profile, interval } = opts;

  if (!positions || positions.length === 0) return [];

  // Determine global start date:
  // - earliest position purchaseDate
  // - else profile.portfolioStartDate
  // - else 1y ago (fallback)
  let start: string | undefined = undefined;

  for (const p of positions) {
    start = minDate(start, p.purchaseDate);
  }
  start = minDate(start, profile?.portfolioStartDate);

  if (!start) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    start = d.toISOString().slice(0, 10);
  }

  // Separate cash-like positions (constant series)
  const cashLike = positions.filter((p) => p.assetClass === "Cash" || p.assetClass === "Money Market");
  const marketLike = positions.filter((p) => !(p.assetClass === "Cash" || p.assetClass === "Money Market"));

  // Build list of tickers to fetch history for
  const tickers = Array.from(
    new Set(
      marketLike
        .map((p) => (p.ticker || "").trim().toUpperCase())
        .filter(Boolean),
    ),
  );

  // If you only have cash-like positions, just return a flat series from start to today with one point.
  if (tickers.length === 0) {
    const cashValue = cashLike.reduce((acc, p) => {
      // cash stored as quantity * unitPrice normally; in your app CASH uses qty=1, price=1, costBasisPerUnit=balance
      // We'll treat "current balance" as: (costBasisPerUnit * quantity) if that’s how it's stored
      return acc + toNumber(p.costBasisPerUnit) * toNumber(p.quantity || 0);
    }, 0);

    return [{ date: start, value: cashValue }];
  }

  const qs = new URLSearchParams();
  qs.set("tickers", tickers.join(","));
  qs.set("start", start);
  qs.set("interval", interval);

  const res = await fetch(`/api/history?${qs.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    // If history fails, return empty to avoid crashing charts
    return [];
  }

  const json = (await res.json()) as HistoryResponse;
  const data = json.data || {};

  // Map positions by ticker
  const positionsByTicker = new Map<string, Position[]>();
  for (const p of marketLike) {
    const t = (p.ticker || "").trim().toUpperCase();
    if (!t) continue;
    const arr = positionsByTicker.get(t) ?? [];
    arr.push(p);
    positionsByTicker.set(t, arr);
  }

  // Build a unified date set across all tickers
  const allDates = new Set<string>();
  for (const t of tickers) {
    for (const pt of data[t] ?? []) allDates.add(pt.date);
  }
  const dates = Array.from(allDates).sort((a, b) => a.localeCompare(b));

  // Forward-fill closes per ticker so portfolio value exists on all dates (esp. when some tickers miss dates)
  const closeByTickerByDate = new Map<string, Map<string, number>>();
  for (const t of tickers) {
    const series = (data[t] ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const map = new Map<string, number>();
    let lastClose: number | undefined = undefined;

    let i = 0;
    for (const d of dates) {
      while (i < series.length && series[i].date <= d) {
        lastClose = series[i].close;
        i++;
      }
      if (typeof lastClose === "number") map.set(d, lastClose);
    }

    closeByTickerByDate.set(t, map);
  }

  // Cash-like constant (no yield modeled yet)
  const cashConstant = cashLike.reduce((acc, p) => {
    return acc + toNumber(p.costBasisPerUnit) * toNumber(p.quantity || 0);
  }, 0);

  // Sum portfolio value by date
  const out: { date: string; value: number }[] = [];
  for (const d of dates) {
    let total = cashConstant;

    for (const t of tickers) {
      const close = closeByTickerByDate.get(t)?.get(d);
      if (typeof close !== "number") continue;

      const plist = positionsByTicker.get(t) ?? [];
      for (const p of plist) {
        const qty = toNumber(p.quantity);
        total += qty * close;
      }
    }

    out.push({ date: d, value: Number(total.toFixed(2)) });
  }

  // If no dates came back (API returned empty), still provide a single point using “today” logic
  if (out.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    const approx = cashConstant + marketLike.reduce((acc, p) => {
      const unit = typeof p.currentPrice === "number" ? p.currentPrice : p.costBasisPerUnit;
      return acc + toNumber(p.quantity) * toNumber(unit);
    }, 0);
    return [{ date: today, value: Number(approx.toFixed(2)) }];
  }

  return out;
}
