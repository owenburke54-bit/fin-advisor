import { NextResponse } from "next/server";

interface HistoryRequest {
  tickers: string[];
  startDate: string; // YYYY-MM-DD
}

type SeriesPoint = { date: string; close: number };

export async function POST(req: Request) {
  try {
    const { tickers, startDate } = (await req.json()) as HistoryRequest;
    if (!Array.isArray(tickers) || !startDate) {
      return NextResponse.json({}, { status: 200 });
    }
    const out: Record<string, SeriesPoint[]> = {};
    const toSymbol = (t: string) => {
      const k = t.replace(/\s+/g, "").toUpperCase();
      if (k === "BTCUSD" || k === "BTC-USD") return "BTC-USD";
      if (k === "ETHUSD" || k === "ETH-USD") return "ETH-USD";
      return t.trim();
    };
    const startTs = Math.floor(new Date(startDate).getTime() / 1000);
    const endTs = Math.floor(Date.now() / 1000);
    for (const t of tickers) {
      const symbol = toSymbol(t);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol,
      )}?period1=${startTs}&period2=${endTs}&interval=1d`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const json = (await res.json()) as any;
      const result = json?.chart?.result?.[0];
      const timestamps: number[] = result?.timestamp ?? [];
      const closes: number[] = result?.indicators?.quote?.[0]?.close ?? [];
      const series: SeriesPoint[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i];
        if (typeof c === "number" && !Number.isNaN(c)) {
          const dt = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
          series.push({ date: dt, close: Number(c.toFixed(4)) });
        }
      }
      out[t.replace(/\s+/g, "").toUpperCase()] = series;
    }
    return NextResponse.json(out, { status: 200 });
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}

