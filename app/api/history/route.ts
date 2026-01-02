// app/api/history/route.ts
import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";

export const runtime = "nodejs";

type Interval = "1d" | "1wk" | "1mo";

type Point = { date: string; close: number };
type Cached = { ts: number; points: Point[]; error?: string };

const CACHE = new Map<string, Cached>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 min
const CACHE_STALE_OK_MS = 1000 * 60 * 60 * 6; // allow up to 6h stale on rate-limit

function isISODate(s?: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseInterval(v: string | null): Interval {
  if (v === "1wk" || v === "1mo" || v === "1d") return v;
  return "1d";
}

function normalizeTicker(t: string) {
  const up = t.trim().toUpperCase();
  if (up.includes("/")) return up.replace("/", "-");
  return up;
}

function cacheKey(ticker: string, start: string, end: string, interval: Interval) {
  return `${ticker}|${start}|${end}|${interval}`;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function looksRateLimited(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = err?.code || err?.name;
  return (
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    code === 429
  );
}

async function fetchHistoricalWithRetry(
  ticker: string,
  start: string,
  end: string,
  interval: Interval
): Promise<{ points: Point[]; error?: string; rateLimited?: boolean }> {
  const period1 = new Date(start + "T00:00:00Z");
  const period2 = new Date(end + "T00:00:00Z");

  const opts: any = { period1, period2, interval };

  // More patient backoff (helps on Vercel)
  const waits = [0, 800, 2000, 5000];
  let lastErr: any = null;

  for (const wait of waits) {
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
      if (!looksRateLimited(e)) break;
    }
  }

  const message = String(lastErr?.message || lastErr || "Unknown error");
  return { points: [], error: message, rateLimited: looksRateLimited(lastErr) };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const tickersParam = searchParams.get("tickers") || "";
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const interval = parseInterval(searchParams.get("interval"));

  const tickers = tickersParam.split(",").map(normalizeTicker).filter(Boolean);

  if (!tickers.length || !isISODate(start) || !isISODate(end)) {
    return NextResponse.json(
      { error: "Missing/invalid params. Need tickers,start,end (YYYY-MM-DD),interval." },
      { status: 400 }
    );
  }

  const out: Record<string, { points: Point[]; error?: string }> = {};

  for (const t of tickers) {
    const key = cacheKey(t, start, end, interval);
    const cached = CACHE.get(key);

    // fresh cache
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      out[t] = { points: cached.points, error: cached.error };
      continue;
    }

    const res = await fetchHistoricalWithRetry(t, start, end, interval);

    // If rate-limited AND we have stale cache, serve stale cache
    if (res.rateLimited && cached && Date.now() - cached.ts < CACHE_STALE_OK_MS) {
      out[t] = { points: cached.points, error: `Using cached data (Yahoo rate limited). ${res.error ?? ""}`.trim() };
      continue;
    }

    CACHE.set(key, { ts: Date.now(), points: res.points, error: res.error });
    out[t] = { points: res.points, error: res.error };
  }

  return NextResponse.json(
    { tickers, interval, start, end, data: out },
    { headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" } }
  );
}
