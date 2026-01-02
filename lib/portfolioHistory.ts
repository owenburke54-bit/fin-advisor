// lib/portfolioHistory.ts
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
  // UPDATED SHAPE: route returns { points, error? } per ticker
  data: Record<string, { points: HistoryPoint[]; error?: string }>;
};

/**
 * Accepts:
 * - YYYY-MM-DD (returns as-is)
 * - M/D/YYYY or MM/DD/YYYY (converts to YYYY-MM-DD)
 * Otherwise returns undefined.
 */
function coerceToISODate(raw?: unknown): string | undefined {
  if (raw == null) return undefined;

  const s: string = typeof raw === "string" ? raw.trim() : String(raw).trim();
  if (!s) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return undefined;

  const mm = String(m[1]).padStart(2, "0");
  const dd = String(m[2]).padStart(2, "0");
  const yyyy = String(m[3]);
  return `${yyyy}-${mm}-${dd}`;
}

function minDate(a?: unknown, b?: unknown): string | undefined {
  const A = coerceToISODate(a);
  const B = coerceToISODate(b);
  if (!A) return B ?? undefined;
  if (!B) return A;
  return A <= B ? A : B;
}

function toNumber(x: unknown, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function clampStartNotFuture(startISO: string, endISO: string): string {
  // If user accidentally sets start date after today, clamp to 30 days back so we still chart.
  if (startISO > endISO) return addDaysISO(endISO, -30);
  return startISO;
}

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit & { timeoutMs?: number } = {},
) {
  const { timeoutMs = 12000, ...rest } = init;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Downsample helpers:
 * We always build a daily (trading-day) series, then:
 * - weekly: keep the last point per week
 * - monthly: keep the last point per month
 *
 * This avoids missing months due to API interval bucketing quirks.
 */
function takeWeekEnd<T extends { date: string }>(points: T[]): T[] {
  const map: Record<string, T> = {};

  for (const p of points) {
    const dt = new Date(p.date + "T00:00:00Z");
    const year = dt.getUTCFullYear();

    const firstJan = new Date(Date.UTC(year, 0, 1));
    const days = Math.floor((dt.getTime() - firstJan.getTime()) / 86400000);
    const week = Math.floor((days + firstJan.getUTCDay()) / 7);

    const key = `${year}-W${week}`;
    map[key] = p; // overwrite keeps last point in week
  }

  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

function takeMonthEnd<T extends { date: string }>(points: T[]): T[] {
  const map: Record<string, T> = {};

  for (const p of points) {
    const dt = new Date(p.date + "T00:00:00Z");
    const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`; // 0-based month bucket
    map[key] = p; // overwrite keeps last point in month
  }

  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

export type PortfolioSeriesPoint = {
  date: string;
  value: number;
  /**
   * Optional per-ticker breakdown for tooltips, allocation views, etc.
   * Keys are tickers (e.g., "VOO", "NVDA") plus "Cash" if applicable.
   */
  breakdown?: Record<string, number>;
};

/**
 * Yahoo history expects e.g. BTC-USD not BTC/USD.
 * Also handles common USD pairs and BTCUSD style.
 */
function normalizeTickerForHistory(ticker: string): string {
  const t = String(ticker || "").trim().toUpperCase();

  // Convert "BTC/USD" -> "BTC-USD"
  if (t.includes("/")) {
    const parts = t.split("/");
    if (parts.length === 2 && parts[1] === "USD") return `${parts[0]}-USD`;
    return t.replace("/", "-");
  }

  // Convert "BTCUSD" -> "BTC-USD"
  if (/^[A-Z]{3,6}USD$/.test(t) && !t.includes("-")) {
    const base = t.replace("USD", "");
    return `${base}-USD`;
  }

  return t;
}

function isCashLike(p: Position): boolean {
  return p.assetClass === "Cash" || p.assetClass === "Money Market";
}

/**
 * Cash-like "CURRENT" value:
 * With your MMKT model:
 *   quantity = 1
 *   costBasisPerUnit = initial balance
 *   currentPrice = current balance
 *
 * For portfolio value charting, we want CURRENT balance if present.
 */
function cashLikeCurrentValue(p: Position): number {
  const cp =
    typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
      ? p.currentPrice
      : undefined;
  if (typeof cp === "number") return cp;

  // fallback to older storage styles
  const qty = toNumber(p.quantity);
  const cb = toNumber(p.costBasisPerUnit);

  // Style A: qty=1, cb=balance
  if (qty === 1) return cb;

  // Style B: qty=balance
  return qty;
}

/**
 * Returns a portfolio value time series using historical closes since purchase date.
 * - For each market position, uses quantity * close on each date
 * - Cash/Money Market treated as constant CURRENT balance (no yield modeled yet)
 *
 * IMPORTANT: This function is designed to NEVER throw.
 */
export async function fetchPortfolioSeries(opts: {
  positions: Position[];
  profile: UserProfile | null;
  interval: Interval;
}): Promise<PortfolioSeriesPoint[]> {
  try {
    const { positions, profile, interval } = opts;

    if (!positions || positions.length === 0) return [];

    // Determine global start date:
    // - earliest position purchaseDate
    // - else profile.portfolioStartDate
    // - else 1y ago
    let start: string | undefined = undefined;

    for (const p of positions) {
      start = minDate(start, p.purchaseDate);
    }
    start = minDate(start, profile?.portfolioStartDate);

    const end = todayISO();

    if (!start) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      start = d.toISOString().slice(0, 10);
    }

    start = clampStartNotFuture(start, end);

    const cashLike = positions.filter(isCashLike);
    const marketLike = positions.filter((p) => !isCashLike(p));

    // Cash-like constant (CURRENT balance)
    const cashConstant = cashLike.reduce(
      (acc, p) => acc + cashLikeCurrentValue(p),
      0,
    );

    // Map market positions by normalized ticker
    const positionsByTicker = new Map<string, Position[]>();
    for (const p of marketLike) {
      const tRaw = (p.ticker || "").trim();
      if (!tRaw) continue;
      const t = normalizeTickerForHistory(tRaw);
      const arr = positionsByTicker.get(t) ?? [];
      arr.push(p);
      positionsByTicker.set(t, arr);
    }

    const tickers = Array.from(new Set(Array.from(positionsByTicker.keys())));

    // If you only have cash-like positions, return flat line with 2 points
    if (tickers.length === 0) {
      const v = Number(cashConstant.toFixed(2));
      const flat: PortfolioSeriesPoint[] = [
        { date: start, value: v, breakdown: cashConstant ? { Cash: v } : {} },
        { date: end, value: v, breakdown: cashConstant ? { Cash: v } : {} },
      ];
      if (interval === "1wk") return takeWeekEnd(flat);
      if (interval === "1mo") return takeMonthEnd(flat);
      return flat;
    }

    // Always fetch DAILY closes then downsample ourselves
    const fetchInterval: Interval = "1d";

    const qs = new URLSearchParams();
    qs.set("tickers", tickers.join(","));
    qs.set("start", start);
    qs.set("end", end);
    qs.set("interval", fetchInterval);

    const res = await fetchWithTimeout(`/api/history?${qs.toString()}`, {
      cache: "no-store",
      timeoutMs: 12000,
    });

    // fallback flat-ish series if history fails
    if (!res.ok) {
      const approx =
        cashConstant +
        marketLike.reduce((acc, p) => {
          const unit =
            typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
              ? p.currentPrice
              : toNumber(p.costBasisPerUnit);
          return acc + toNumber(p.quantity) * toNumber(unit);
        }, 0);

      const v = Number(approx.toFixed(2));
      const flat: PortfolioSeriesPoint[] = [
        { date: start, value: v },
        { date: end, value: v },
      ];
      if (interval === "1wk") return takeWeekEnd(flat);
      if (interval === "1mo") return takeMonthEnd(flat);
      return flat;
    }

    const json = (await res.json()) as HistoryResponse;
    const data = json?.data || {};

    // Unified date set across all tickers
    const allDates = new Set<string>();
    for (const t of tickers) {
      for (const pt of data[t]?.points ?? []) allDates.add(pt.date);
    }
    const dates = Array.from(allDates).sort((a, b) => a.localeCompare(b));

    // If API returned no dates at all, return approx flat series
    if (dates.length === 0) {
      const approx =
        cashConstant +
        marketLike.reduce((acc, p) => {
          const unit =
            typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
              ? p.currentPrice
              : toNumber(p.costBasisPerUnit);
          return acc + toNumber(p.quantity) * toNumber(unit);
        }, 0);

      const v = Number(approx.toFixed(2));
      const flat: PortfolioSeriesPoint[] = [
        { date: start, value: v },
        { date: end, value: v },
      ];
      if (interval === "1wk") return takeWeekEnd(flat);
      if (interval === "1mo") return takeMonthEnd(flat);
      return flat;
    }

    // Forward-fill closes per ticker so portfolio value exists on all dates
    const closeByTickerByDate = new Map<string, Map<string, number>>();
    for (const t of tickers) {
      const series = (data[t]?.points ?? [])
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));

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

    // Sum portfolio value by date + breakdown by ticker
    const out: PortfolioSeriesPoint[] = [];

    for (const d of dates) {
      const breakdown: Record<string, number> = {};
      let total = 0;

      if (cashConstant !== 0) {
        const cashRounded = Number(cashConstant.toFixed(2));
        breakdown["Cash"] = cashRounded;
        total += cashConstant;
      }

      for (const t of tickers) {
        const close = closeByTickerByDate.get(t)?.get(d);
        if (typeof close !== "number") continue;

        const plist = positionsByTicker.get(t) ?? [];
        let tickerValue = 0;

        for (const p of plist) {
          tickerValue += toNumber(p.quantity) * close;
        }

        if (tickerValue !== 0) {
          const rounded = Number(tickerValue.toFixed(2));
          breakdown[t] = rounded;
          total += tickerValue;
        }
      }

      out.push({
        date: d,
        value: Number(total.toFixed(2)),
        breakdown,
      });
    }

    // Ensure at least 2 points for charts
    if (out.length === 1) out.push({ ...out[0], date: end });

    // Downsample to requested interval (preserves breakdown)
    if (interval === "1wk") return takeWeekEnd(out);
    if (interval === "1mo") return takeMonthEnd(out);
    return out;
  } catch {
    // Never let the UI hang
    return [];
  }
}
