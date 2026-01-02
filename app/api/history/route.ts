// app/api/history/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Interval = "1d" | "1wk" | "1mo";
type Point = { date: string; close: number };

type Cached = { ts: number; points: Point[]; error?: string };
const CACHE = new Map<string, Cached>();

// Longer cache is totally fine for history
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function isISODate(s?: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseInterval(v: string | null): Interval {
  if (v === "1wk" || v === "1mo" || v === "1d") return v;
  return "1d";
}

function cacheKey(ticker: string, start: string, end: string, interval: Interval) {
  return `${ticker}|${start}|${end}|${interval}`;
}

function normalizeTicker(t: string) {
  return String(t || "").trim().toUpperCase();
}

function isCryptoTicker(t: string) {
  // Supports BTC-USD, ETH-USD, BTC/USD
  const up = normalizeTicker(t).replace("/", "-");
  return up.endsWith("-USD");
}

/**
 * Stooq uses symbols like:
 *   VOO.US, NVDA.US, SPY.US, AMZN.US
 * We’ll default to US for normal equities/ETFs.
 * If you later want international, we can expand mapping.
 */
function toStooqSymbol(ticker: string) {
  const t = normalizeTicker(ticker);
  // If user already passed .US or .DE etc, keep it
  if (t.includes(".")) return t.toLowerCase();
  return `${t}.US`.toLowerCase();
}

function isoToUnixSeconds(iso: string) {
  return Math.floor(new Date(iso + "T00:00:00Z").getTime() / 1000);
}

function filterByRange(points: Point[], start: string, end: string) {
  return points.filter((p) => p.date >= start && p.date <= end);
}

/** Downsample daily points to week-end/month-end (last point in bucket) */
function takeWeekEnd(points: Point[]): Point[] {
  const map: Record<string, Point> = {};
  for (const p of points) {
    const dt = new Date(p.date + "T00:00:00Z");
    const year = dt.getUTCFullYear();
    const firstJan = new Date(Date.UTC(year, 0, 1));
    const days = Math.floor((dt.getTime() - firstJan.getTime()) / 86400000);
    const week = Math.floor((days + firstJan.getUTCDay()) / 7);
    map[`${year}-W${week}`] = p; // last in bucket wins
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

function takeMonthEnd(points: Point[]): Point[] {
  const map: Record<string, Point> = {};
  for (const p of points) {
    const dt = new Date(p.date + "T00:00:00Z");
    map[`${dt.getUTCFullYear()}-${dt.getUTCMonth()}`] = p; // last in bucket wins
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

function downsample(points: Point[], interval: Interval) {
  if (interval === "1wk") return takeWeekEnd(points);
  if (interval === "1mo") return takeMonthEnd(points);
  return points;
}

/**
 * Fetch daily OHLC from Stooq (CSV).
 * Endpoint format:
 *   https://stooq.com/q/d/l/?s=voo.us&i=d
 */
async function fetchStooqDaily(ticker: string): Promise<Point[]> {
  const sym = toStooqSymbol(ticker);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;

  const res = await fetch(url, {
    // Stooq is public; caching OK server-side
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Stooq fetch failed (${res.status})`);

  const text = await res.text();
  const lines = text.trim().split("\n");
  // header: Date,Open,High,Low,Close,Volume
  if (lines.length <= 1) return [];

  const out: Point[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const date = parts[0]?.trim();
    const closeStr = parts[4]?.trim();
    const close = Number(closeStr);
    if (!date || !Number.isFinite(close)) continue;
    // Stooq uses YYYY-MM-DD already
    out.push({ date, close });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * CoinGecko mapping for common tickers.
 * If you want more coins later, we can add a lookup endpoint.
 */
function toCoinGeckoId(ticker: string): string | null {
  const t = normalizeTicker(ticker).replace("/", "-");
  if (t.startsWith("BTC-")) return "bitcoin";
  if (t.startsWith("ETH-")) return "ethereum";
  return null;
}

/**
 * Fetch crypto daily close from CoinGecko.
 * market_chart/range returns [timestamp, price] pairs.
 */
async function fetchCoinGeckoDaily(ticker: string, startISO: string, endISO: string): Promise<Point[]> {
  const id = toCoinGeckoId(ticker);
  if (!id) return [];

  const from = isoToUnixSeconds(startISO);
  // add +1 day so end date is inclusive for range requests
  const to = isoToUnixSeconds(endISO) + 86400;

  const url =
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}` +
    `/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`CoinGecko fetch failed (${res.status})`);

  const json = (await res.json()) as { prices?: [number, number][] };
  const prices = Array.isArray(json?.prices) ? json.prices : [];

  // CoinGecko gives many points per day; bucket to last price per day
  const dayMap: Record<string, Point> = {};
  for (const [ts, price] of prices) {
    const d = new Date(ts);
    const iso = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
      .toISOString()
      .slice(0, 10);
    if (!Number.isFinite(price)) continue;
    dayMap[iso] = { date: iso, close: Number(price) }; // last in day wins
  }

  const out = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
  return filterByRange(out, startISO, endISO);
}

async function fetchHistory(ticker: string, start: string, end: string): Promise<Point[]> {
  if (isCryptoTicker(ticker)) return await fetchCoinGeckoDaily(ticker, start, end);
  // Equities/ETFs default to Stooq
  const daily = await fetchStooqDaily(ticker);
  return filterByRange(daily, start, end);
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

  const out: Record<string, { points: Point[]; error?: string }> = {};

  for (const t of tickers) {
    const key = cacheKey(t, start, end, interval);
    const cached = CACHE.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      out[t] = { points: cached.points, error: cached.error };
      continue;
    }

    try {
      const pointsDaily = await fetchHistory(t, start, end);
      const points = downsample(pointsDaily, interval);

      CACHE.set(key, { ts: Date.now(), points });
      out[t] = { points };
    } catch (e: any) {
      const msg = String(e?.message || e || "Unknown error");
      CACHE.set(key, { ts: Date.now(), points: [], error: msg });
      out[t] = { points: [], error: msg };
    }
  }

  return NextResponse.json(
    { tickers, interval, start, end, data: out },
    { headers: { "Cache-Control": "s-maxage=21600, stale-while-revalidate=86400" } } // 6h CDN cache
  );
}
