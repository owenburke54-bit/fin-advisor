// app/api/history/route.ts
import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";

export const runtime = "nodejs";

// Cache in-memory (works well on a warm lambda; also reduces repeat calls in local dev)
type Cached = { ts: number; points: { date: string; close: number }[]; error?: string };
const CACHE = new Map<string, Cached>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 min

type Interval = "1d" | "1wk" | "1mo";

function isISODate(s?: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseInterval(v: string | null): Interval {
  if (v === "1wk" || v === "1mo" || v === "1d") return v;
  return "1d";
}

function normalizeTicker(t: string) {
  // Handle crypto style tickers
  const up = t.trim().toUpperCase();
  if (up.includes("/")) return up.replace("/", "-"); // BTC/USD -> BTC-USD
  return up;
}

function cacheKey(ticker: string, start: string, end: string, interval: Interval) {
  return `${ticker}|${start}|${end}|${interval}`;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHistoricalWithRetry(ticker: string, start: string, end: string, interval: Interval) {
  // yahoo-finance2 expects Date for period1/period2
  const period1 = new Date(start + "T00:00:00Z");
  const period2 = new Date(end + "T00:00:00Z");

  const opts: any = {
    period1,
    period2,
    interval,
  };

  // Simple retry on 429 / rate-limit-ish errors
  const tries = [0, 600, 1500]; // immediate, then backoff
  let lastErr: any = null;

  for (const wait of tries) {
    if (wait) await sleep(wait);
    try {
      const raw = (await yahooFinance.historical(ticker, opts)) as any;

      const rows: any[] = Array.isArray(raw) ? raw : [];
      const points = rows
        .filter((r) => r?.date && typeof r?.close === "number")
        .map((r) => ({
          date: new Date(r.date).toISOString().slice(0, 10),
          close: Number(r.close),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return { points };
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e || "");
      const code = e?.code || e?.name;

      // retry only on rate limits / transient
      const looksRateLimited =
        msg.toLowerCase().includes("too many requests") ||
        msg.toLowerCase().includes("rate limit") ||
        msg.includes("429") ||
        code === 429;

      if (!looksRateLimited) break;
    }
  }

  const message = String(lastErr?.message || lastErr || "Unknown error");
  return { points: [], error: message };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const tickersParam = searchParams.get("tickers") || "";
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const interval = parseInterval(searchParams.get("interval"));

  const tickers = tickersParam
    .split(",")
    .map(normalizeTicker)
    .filter(Boolean);

  if (!tickers.length || !isISODate(start) || !isISODate(end)) {
    return NextResponse.json(
      { error: "Missing/invalid params. Need tickers,start,end (YYYY-MM-DD),interval." },
      { status: 400 }
    );
  }

  const out: Record<string, { points: { date: string; close: number }[]; error?: string }> = {};

  for (const t of tickers) {
    const key = cacheKey(t, start, end, interval);
    const cached = CACHE.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      out[t] = { points: cached.points, error: cached.error };
      continue;
    }

    const res = await fetchHistoricalWithRetry(t, start, end, interval);

    CACHE.set(key, { ts: Date.now(), points: res.points, error: res.error });
    out[t] = { points: res.points, error: res.error };
  }

  // Cache hint for browsers/CDN (still fine even if lambda cold-starts)
  return NextResponse.json(
    { tickers, interval, start, end, data: out },
    { headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" } }
  );
}
