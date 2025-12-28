import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";

export const runtime = "nodejs"; // yahoo-finance2 needs Node runtime
export const dynamic = "force-dynamic";

function parseDateParam(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function clampStart(start?: Date): Date | undefined {
  if (!start) return undefined;
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  return start < tenYearsAgo ? tenYearsAgo : start;
}

function normalizeYahooSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();

  // Common convenience: BTCUSD, ETHUSD -> BTC-USD, ETH-USD
  if (/^[A-Z]{2,10}USD$/.test(t)) return `${t.slice(0, -3)}-USD`;

  return t;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const tickersParam = searchParams.get("tickers") || searchParams.get("ticker") || "";
    const tickers = tickersParam
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    if (tickers.length === 0) {
      return NextResponse.json(
        { error: "Missing query param: tickers (e.g. ?tickers=AAPL,VOO)" },
        { status: 400 },
      );
    }

    const interval = (searchParams.get("interval") || "1d") as "1d" | "1wk" | "1mo";
    const startRaw = parseDateParam(searchParams.get("start"));
    const endRaw = parseDateParam(searchParams.get("end"));

    const start = clampStart(startRaw);
    const end = endRaw;

    // Fetch all tickers in parallel
    const results = await Promise.all(
      tickers.map(async (ticker) => {
        const symbol = normalizeYahooSymbol(ticker);

        const rows = await yahooFinance.historical(symbol, {
          period1: start,
          period2: end,
          interval,
        });

        const points =
          (rows ?? [])
            .filter((r) => r?.date && typeof r?.close === "number" && Number.isFinite(r.close))
            .map((r) => ({
              date: new Date(r.date as any).toISOString().slice(0, 10), // YYYY-MM-DD
              close: Number(r.close),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return [ticker, points] as const;
      }),
    );

    const data = Object.fromEntries(results);

    return NextResponse.json(
      {
        tickers,
        interval,
        start: start ? start.toISOString().slice(0, 10) : undefined,
        end: end ? end.toISOString().slice(0, 10) : undefined,
        data,
      },
      {
        status: 200,
        headers: {
          // cache at Vercel edge (helps a LOT with Yahoo throttling)
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "History fetch failed" },
      { status: 500 },
    );
  }
}
