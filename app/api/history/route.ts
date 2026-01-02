// app/api/history/route.ts
import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";

export const runtime = "nodejs";

type Interval = "1d" | "1wk" | "1mo";
type Point = { date: string; close: number };

type TickerResult = { points: Point[]; error?: string };

// In-memory cache (works on warm lambda)
type Cached = { ts: number; value: TickerResult };
const CACHE = new Map<string, Cached>();

// IMPORTANT: Yahoo rate-limits hard. Longer TTL reduces repeat hammering.
// (You can tune this later.)
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

// Deduplicate identical in-flight fetches within the same lambda instance
const IN_FLIGHT = new Map<string, Promise<TickerResult>>();

// Simple concurrency limiter (per lambda instance)
const MAX_CONCURRENT = 2;
let active = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(() => {
    active++;
    resolve();
  }));
}

function release() {
  active = Math.max(0, active - 1);
  const next = queue.shift();
  if (next) next();
}

function isISODate(s?: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseInterval(v: string | null): Interval {
  if (v === "1wk" || v === "1mo" || v === "1d") return v;
  return "1d";
}

/**
 * Normalize tickers for yahoo-finance2:
 * - "BTC/USD" -> "BTC-USD"
 * - "BTCUSD"  -> "BTC-USD"
 * - keeps equities/ETFs as-is (uppercased)
 */
function normalizeTicker(t: string): string {
  const up = String(t || "").trim().toUpperCase();
  if (!up) return "";

  if (up.includes("/")) return up.replace("/", "-"); // BTC/USD -> BTC-USD

  // BTCUSD style -> BTC-USD (common)
  if (/^[A-Z]{3,6}USD$/.test(up) && !up.includes("-")) {
    const base = up.replace("USD", "");
    return `${base}-USD`;
  }

  return up;
}

function cacheKey(ticker: string, start: string, end: string, interval: Interval) {
  return `${ticker}|${start}|${end}|${interval}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function looksRateLimited(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = err?.code ?? err?.statusCode ?? err?.response?.status ?? err?.name;

  return (
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("status code 429") ||
    msg.includes("429") ||
    code === 429 ||
    code === "429"
  );
}

function formatYahooError(err: any): string {
  const msg = String(err?.message || err || "Unknown error");
  const code = err?.code ?? err?.statusCode ?? err?.response?.status ?? "";
  return code ? `${msg} (code: ${code})` : msg;
}

async function fetchHistoricalOnce(
  ticker: string,
  start: string,
  end: string,
  interval: Interval
): Promise<TickerResult> {
  // yahoo-finance2 expects Date for period1/period2
  const period1 = new Date(start + "T00:00:00Z");
  const period2 = new Date(end + "T00:00:00Z");

  const opts: any = { period1, period2, interval };

  const raw = (await yahooFinance.historical(ticker, opts)) as any;
  const rows: any[] = Array.isArray(raw) ? raw : [];

  const points: Point[] = rows
    .filter((r) => r?.date && typeof r?.close === "number")
    .map((r) => ({
      date: new Date(r.date).toISOString().slice(0, 10),
      close: Number(r.close),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { points };
}

/**
 * Rate-limit safe wrapper:
 * - concurrency limited
 * - retries w/ exponential backoff + jitter on 429/rate-limit
 * - in-flight dedupe
 * - cached responses (including errors) to avoid hammering Yahoo
 */
async function fetchHistoricalWithRetryCached(
  ticker: string,
  start: string,
  end: string,
  interval: Interval
): Promise<TickerResult> {
  const key = cacheKey(ticker, start, end, interval);

  // Serve fresh cache
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }

  // In-flight dedupe
  const inflight = IN_FLIGHT.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    await acquire();
    try {
      // Retry schedule (ms): exponential + jitter
      const base = [0, 800, 2000, 4500];
      let lastErr: any = null;

      for (let i = 0; i < base.length; i++) {
        const wait = base[i];
        if (wait > 0) {
          const jitter = Math.floor(Math.random() * 300);
          await sleep(wait + jitter);
        }

        try {
          const res = await fetchHistoricalOnce(ticker, start, end, interval);
          const value: TickerResult = { points: res.points };

          CACHE.set(key, { ts: Date.now(), value });
          return value;
        } catch (e: any) {
          lastErr = e;

          // If not a rate limit / transient error, stop retrying
          if (!looksRateLimited(e)) break;
        }
      }

      const value: TickerResult = {
        points: [],
        error: formatYahooError(lastErr),
      };

      // Cache errors too (prevents rapid repeat hammering)
      CACHE.set(key, { ts: Date.now(), value });
      return value;
    } finally {
      release();
      IN_FLIGHT.delete(key);
    }
  })();

  IN_FLIGHT.set(key, p);
  return p;
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

  // Fetch sequentially but with concurrency limit handled inside
  // (This prevents 12 parallel Yahoo calls from one request)
  const out: Record<string, TickerResult> = {};
  for (const t of tickers) {
    out[t] = await fetchHistoricalWithRetryCached(t, start, end, interval);
  }

  // NOTE: Return shape matches lib/portfolioHistory.ts expectation:
  // data[ticker] = { points, error? }
  return NextResponse.json(
    { tickers, interval, start, end, data: out },
    {
      headers: {
        // CDN hint (still safe if cold starts happen)
        "Cache-Control": "s-maxage=21600, stale-while-revalidate=86400", // 6h + 24h stale
      },
    }
  );
}
