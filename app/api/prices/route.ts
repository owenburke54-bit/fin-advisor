import { NextResponse } from "next/server";

type TickerInfo = { price: number; name?: string; sector?: string };

export async function POST(req: Request) {
  try {
    const { tickers } = (await req.json()) as { tickers: string[] };
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({}, { status: 200 });
    }

    // Normalize and map special cases
    const normalized = tickers.map((t) => t.trim()).filter(Boolean);
    const yahooSymbols = normalized.map(toYahooSymbol);
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      yahooSymbols.join(","),
    )}`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({}, { status: 200 });
    }
    const json = (await res.json()) as any;
    const results: any[] = json?.quoteResponse?.result ?? [];

    const out: Record<string, TickerInfo> = {};
    // Build a reverse index by yahoo symbol to input tickers
    const byYahoo = new Map<string, string>();
    for (let i = 0; i < normalized.length; i++) {
      byYahoo.set(yahooSymbols[i].toUpperCase(), normalized[i]);
    }

    for (const r of results) {
      const yahooSymbol: string = String(r.symbol || "").toUpperCase();
      const inputTicker = byYahoo.get(yahooSymbol);
      if (!inputTicker) continue;
      const key = normalizeKey(inputTicker);
      const name: string | undefined = r.longName || r.shortName || undefined;
      const price: number | undefined = r.regularMarketPrice ?? r.postMarketPrice ?? r.preMarketPrice;
      if (typeof price === "number") {
        out[key] = { price: Number(price.toFixed(2)), name };
      }
    }

    // Handle CASH / SPAXX explicitly
    for (const t of normalized) {
      const key = normalizeKey(t);
      if (!out[key]) {
        if (key === "CASH" || key === "SPAXX") {
          out[key] = { price: 1.0, name: key === "CASH" ? "Cash" : "Fidelity Government Money Market" };
        } else if (key === "BTCUSD") {
          // Try BTC-USD again if direct match failed
          const btc = results.find((r) => String(r.symbol || "").toUpperCase() === "BTC-USD");
          if (btc?.regularMarketPrice) {
            out[key] = { price: Number(btc.regularMarketPrice.toFixed(2)), name: "Bitcoin USD" };
          }
        } else if (key === "ETHUSD") {
          const eth = results.find((r) => String(r.symbol || "").toUpperCase() === "ETH-USD");
          if (eth?.regularMarketPrice) {
            out[key] = { price: Number(eth.regularMarketPrice.toFixed(2)), name: "Ethereum USD" };
          }
        }
      }
    }

    return NextResponse.json(out, { status: 200 });
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}

function toYahooSymbol(t: string): string {
  const k = normalizeKey(t);
  if (k === "BTCUSD" || k === "BTC-USD") return "BTC-USD";
  if (k === "ETHUSD" || k === "ETH-USD") return "ETH-USD";
  if (k === "CASH") return "SPAXX"; // approximate with money market NAV
  return t.trim(); // assume direct Yahoo symbol
}

function normalizeKey(t: string): string {
  return t.replace(/\s+/g, "").toUpperCase();
}

