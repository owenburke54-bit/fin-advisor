type TickerInfo = { price: number; name?: string; sector?: string };

// Public API: fetch prices for a list of tickers.
// Tries live quotes via our server route, falls back to a simple mock if needed.
export async function fetchPricesForTickers(
  tickers: string[],
): Promise<Record<string, TickerInfo>> {
  const cleaned = tickers
    .map((t) => t.trim())
    .filter(Boolean);

  // If running in the browser, call our serverless route for quotes (avoids CORS/API key issues)
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ tickers: cleaned }),
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, TickerInfo>;
        return data;
      }
    } catch {
      // fall through to mock
    }
  }

  // Fallback mock with conservative defaults
  const out: Record<string, TickerInfo> = {};
  for (const t of cleaned) {
    const key = normalizeKey(t);
    out[key] = mockPrice(key);
  }
  return out;
}

function normalizeKey(t: string): string {
  return t.replace(/\s+/g, "").toUpperCase();
}

function mockPrice(key: string): TickerInfo {
  // Very simple base-price fallback
  const BASES: Record<string, number> = {
    VOO: 480,
    SPY: 520,
    AAPL: 190,
    MSFT: 370,
    NVDA: 500,
    AMZN: 170,
    META: 500,
    CRM: 265,
    SNOW: 220,
    SN: 115,
    FXAIX: 240,
    SPAXX: 1.0,
    BTCUSD: 90000,
    BTCUSD2: 90000,
    "BTC-USD": 90000,
    ETHUSD: 3000,
    "ETH-USD": 3000,
    CASH: 1.0,
  };
  const base = BASES[key] ?? 100;
  return { price: Number(base.toFixed(2)) };
}

