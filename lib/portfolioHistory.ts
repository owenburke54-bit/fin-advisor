// lib/portfolioHistory.ts
import type { Position, UserProfile } from "./types";

type Interval = "1d" | "1wk" | "1mo";

type HistoryPoint = {
  date: string; // YYYY-MM-DD
  close: number;
};

type HistoryTickerPayload = {
  points: HistoryPoint[];
  error?: string;
};

type HistoryResponse = {
  tickers: string[]; // IMPORTANT: these are the ACTUAL keys in data
  interval: Interval;
  start?: string;
  end?: string;
  data: Record<string, HistoryTickerPayload>;
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
 * We always build a daily series, then:
 * - weekly: keep last point per week
 * - monthly: keep last point per month
 */
function takeWeekEnd<T extends { date: string }>(points: T[]): T[] {
  const map: Record<string, T> = {};

  for (const p of points) {
    const dt = new Date(p.date + "T00:00:00Z");
    const year = dt.getUTCFullYear();

    const firstJan = new Date(Date.UTC(year, 0, 1));
    const days = Math.floor((dt.getTime() - firstJan.getTime()) / 86400000);
    const week = Math.floor((days + firstJan.getUTCDay()) / 7);

    map[`${year}-W${week}`] = p;
  }

  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

function takeMonthEnd<T extends { date: string }>(points: T[]): T[] {
  const map: Record<string, T> = {};

  for (const p of points) {
    const dt = new Date(p.date + "T00:00:00Z");
    map[`${dt.getUTCFullYear()}-${dt.getUTCMonth()}`] = p;
  }

  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

export type PortfolioSeriesPoint = {
  date: string;
  value: number;
  breakdown?: Record<string, number>;
};

/**
 * Normalize user tickers into what we SEND to the server.
 * Server may further normalize into provider-specific keys (stooq, coingecko).
 */
function normalizeTickerForHistory(ticker: string): string {
  const t = String(ticker || "").trim().toUpperCase();

  if (t.includes("/")) return t.replace("/", "-"); // BTC/USD -> BTC-USD

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
 * Cash-like CURRENT value (for MMKT):
 * quantity=1
 * costBasisPerUnit=initial balance
 * currentPrice=current balance
 */
function cashLikeCurrentValue(p: Position): number {
  const cp =
    typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
      ? p.currentPrice
      : undefined;
  if (typeof cp === "number") return cp;

  const qty = toNumber(p.quantity);
  const cb = toNumber(p.costBasisPerUnit);
  if (qty === 1) return cb;
  return qty;
}

/**
 * Pick the "best" payload from the response for a requested ticker:
 * - Prefer exact match
 * - Else case-insensitive match
 * - Else if only one key returned, use it
 */
function pickPayloadForRequestedTicker(
  data: HistoryResponse["data"],
  returnedKeys: string[],
  requested: string,
): { key: string; payload: HistoryTickerPayload } | null {
  if (!data) return null;

  const exact = data[requested];
  if (exact) return { key: requested, payload: exact };

  const reqUpper = requested.toUpperCase();
  const ciKey = returnedKeys.find((k) => k.toUpperCase() === reqUpper);
  if (ciKey && data[ciKey]) return { key: ciKey, payload: data[ciKey] };

  if (returnedKeys.length === 1) {
    const only = returnedKeys[0];
    if (data[only]) return { key: only, payload: data[only] };
  }

  return null;
}

/**
 * Returns a portfolio value time series using historical closes since purchase date.
 * - Market positions: quantity * close on each date
 * - Cash/MMKT: constant CURRENT balance (no yield modeled)
 *
 * Never throws.
 */
export async function fetchPortfolioSeries(opts: {
  positions: Position[];
  profile: UserProfile | null;
  interval: Interval;
}): Promise<PortfolioSeriesPoint[]> {
  try {
    const { positions, profile, interval } = opts;
    if (!positions || positions.length === 0) return [];

    // Global start date = earliest purchaseDate OR profile start OR 1y ago
    let start: string | undefined = undefined;
    for (const p of positions) start = minDate(start, p.purchaseDate);
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

    const cashConstant = cashLike.reduce((acc, p) => acc + cashLikeCurrentValue(p), 0);

    // Map market positions by normalized ticker (what we SEND)
    const positionsByTicker = new Map<string, Position[]>();
    for (const p of marketLike) {
      const raw = (p.ticker || "").trim();
      if (!raw) continue;
      const t = normalizeTickerForHistory(raw);
      const arr = positionsByTicker.get(t) ?? [];
      arr.push(p);
      positionsByTicker.set(t, arr);
    }

    const requestedTickers = Array.from(new Set(Array.from(positionsByTicker.keys())));

    // Only cash/MMKT => flat line
    if (requestedTickers.length === 0) {
      const v = Number(cashConstant.toFixed(2));
      const flat: PortfolioSeriesPoint[] = [
        { date: start, value: v, breakdown: cashConstant ? { Cash: v } : {} },
        { date: end, value: v, breakdown: cashConstant ? { Cash: v } : {} },
      ];
      if (interval === "1wk") return takeWeekEnd(flat);
      if (interval === "1mo") return takeMonthEnd(flat);
      return flat;
    }

    // Always request DAILY and downsample ourselves
    const fetchInterval: Interval = "1d";

    const qs = new URLSearchParams();
    qs.set("tickers", requestedTickers.join(","));
    qs.set("start", start);
    qs.set("end", end);
    qs.set("interval", fetchInterval);

    const res = await fetchWithTimeout(`/api/history?${qs.toString()}`, {
      cache: "no-store",
      timeoutMs: 12000,
    });

    // If history fails, return flat-ish series using current prices
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
      const flat: PortfolioSeriesPoint[] = [{ date: start, value: v }, { date: end, value: v }];
      if (interval === "1wk") return takeWeekEnd(flat);
      if (interval === "1mo") return takeMonthEnd(flat);
      return flat;
    }

    const json = (await res.json()) as HistoryResponse;
    const data = json?.data || {};
    const returnedKeys = Array.isArray(json?.tickers) ? json.tickers : Object.keys(data);

    // Build a mapping: requested ticker -> actual response key (if different)
    const resolvedKeyByRequested = new Map<string, string>();
    for (const req of requestedTickers) {
      const hit = pickPayloadForRequestedTicker(data, returnedKeys, req);
      if (hit) resolvedKeyByRequested.set(req, hit.key);
    }

    // Unified date set across ALL returned series we can resolve
    const allDates = new Set<string>();
    for (const req of requestedTickers) {
      const key = resolvedKeyByRequested.get(req);
      if (!key) continue;
      const pts = data[key]?.points ?? [];
      for (const pt of pts) allDates.add(pt.date);
    }

    const dates = Array.from(allDates).sort((a, b) => a.localeCompare(b));

    // No dates => fallback flat
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
      const flat: PortfolioSeriesPoint[] = [{ date: start, value: v }, { date: end, value: v }];
      if (interval === "1wk") return takeWeekEnd(flat);
      if (interval === "1mo") return takeMonthEnd(flat);
      return flat;
    }

    // Forward-fill close per requested ticker using its resolved response key
    const closeByRequestedByDate = new Map<string, Map<string, number>>();

    for (const req of requestedTickers) {
      const key = resolvedKeyByRequested.get(req);
      const series = (key ? data[key]?.points : undefined) ?? [];
      const sorted = series.slice().sort((a, b) => a.date.localeCompare(b.date));

      const map = new Map<string, number>();
      let lastClose: number | undefined = undefined;

      let i = 0;
      for (const d of dates) {
        while (i < sorted.length && sorted[i].date <= d) {
          lastClose = sorted[i].close;
          i++;
        }
        if (typeof lastClose === "number") map.set(d, lastClose);
      }

      closeByRequestedByDate.set(req, map);
    }

    // Sum portfolio by date + breakdown
    const out: PortfolioSeriesPoint[] = [];

    for (const d of dates) {
      const breakdown: Record<string, number> = {};
      let total = 0;

      if (cashConstant !== 0) {
        const cashRounded = Number(cashConstant.toFixed(2));
        breakdown["Cash"] = cashRounded;
        total += cashConstant;
      }

      for (const req of requestedTickers) {
        const close = closeByRequestedByDate.get(req)?.get(d);
        if (typeof close !== "number") continue;

        const plist = positionsByTicker.get(req) ?? [];
        let tickerValue = 0;

        for (const p of plist) tickerValue += toNumber(p.quantity) * close;

        if (tickerValue !== 0) {
          breakdown[req] = Number(tickerValue.toFixed(2));
          total += tickerValue;
        }
      }

      out.push({ date: d, value: Number(total.toFixed(2)), breakdown });
    }

    if (out.length === 1) out.push({ ...out[0], date: end });

    if (interval === "1wk") return takeWeekEnd(out);
    if (interval === "1mo") return takeMonthEnd(out);
    return out;
  } catch {
    return [];
  }
}
