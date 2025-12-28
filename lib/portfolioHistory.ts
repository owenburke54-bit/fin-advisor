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
  if (startISO > endISO) {
    return addDaysISO(endISO, -30);
  }
  return startISO;
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit & { timeoutMs?: number } = {}) {
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
 * Returns a portfolio value time series using historical closes since purchase date.
 * - For each position, uses quantity * close on each date
 * - CASH / Money Market is treated as constant balance across time (no yield modeled yet)
 *
 * IMPORTANT: This function is designed to NEVER throw (so your UI won't stay stuck "loading").
 */
export async function fetchPortfolioSeries(opts: {
  positions: Position[];
  profile: UserProfile | null;
  interval: Interval;
}): Promise<{ date: string; value: number }[]> {
  try {
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

    const end = todayISO();

    if (!start) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      start = d.toISOString().slice(0, 10);
    }

    start = clampStartNotFuture(start, end);

    // Separate cash-like positions (constant series)
    const cashLike = positions.filter(
      (p) => p.assetClass === "Cash" || p.assetClass === "Money Market",
    );
    const marketLike = positions.filter(
      (p) => !(p.assetClass === "Cash" || p.assetClass === "Money Market"),
    );

    // Cash-like constant value (no yield modeled yet)
    // NOTE: In your app, cash/MM can be stored as qty=1 & costBasisPerUnit=balance.
    const cashConstant = cashLike.reduce((acc, p) => {
      return acc + toNumber(p.costBasisPerUnit) * toNumber(p.quantity || 0);
    }, 0);

    // Build list of tickers to fetch history for
    const tickers = Array.from(
      new Set(
        marketLike
          .map((p) => (p.ticker || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    );

    // If you only have cash-like positions, return a *flat line with 2 points*
    // so the chart renders (many chart setups look broken with 1 point).
    if (tickers.length === 0) {
      return [
        { date: start, value: Number(cashConstant.toFixed(2)) },
        { date: end, value: Number(cashConstant.toFixed(2)) },
      ];
    }

    const qs = new URLSearchParams();
    qs.set("tickers", tickers.join(","));
    qs.set("start", start);
    qs.set("end", end);
    qs.set("interval", interval);

    const res = await fetchWithTimeout(`/api/history?${qs.toString()}`, {
      cache: "no-store",
      timeoutMs: 12000,
    });

    if (!res.ok) {
      // fallback to 2-point approximation
      const approx =
        cashConstant +
        marketLike.reduce((acc, p) => {
          const unit = typeof p.currentPrice === "number" ? p.currentPrice : p.costBasisPerUnit;
          return acc + toNumber(p.quantity) * toNumber(unit);
        }, 0);

      const v = Number(approx.toFixed(2));
      return [
        { date: start, value: v },
        { date: end, value: v },
      ];
    }

    const json = (await res.json()) as HistoryResponse;
    const data = json?.data || {};

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

    // If API returned no dates at all, return approx flat series
    if (dates.length === 0) {
      const approx =
        cashConstant +
        marketLike.reduce((acc, p) => {
          const unit = typeof p.currentPrice === "number" ? p.currentPrice : p.costBasisPerUnit;
          return acc + toNumber(p.quantity) * toNumber(unit);
        }, 0);

      const v = Number(approx.toFixed(2));
      return [
        { date: start, value: v },
        { date: end, value: v },
      ];
    }

    // Forward-fill closes per ticker so portfolio value exists on all dates
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

    // Ensure we have at least 2 points for the chart
    if (out.length === 1) {
      out.push({ date: end, value: out[0].value });
    }

    return out;
  } catch {
    // Never let the UI hang.
    return [];
  }
}
