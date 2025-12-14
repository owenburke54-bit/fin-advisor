import { NextRequest, NextResponse } from "next/server";
import { Position } from "@/lib/types";

type HistoryPoint = { t: number; v: number };

type HistoryRequest = {
  positions: Array<
    Pick<
      Position,
      "ticker" | "assetClass" | "quantity" | "costBasisPerUnit" | "purchaseDate"
    >
  >;
  startDate?: string; // ISO date string
  endDate?: string; // ISO date string
};

const DAY_S = 24 * 60 * 60;

async function fetchYahooDaily(
  symbol: string,
  startTs: number,
  endTs: number,
): Promise<Map<number, number>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?period1=${startTs}&period2=${endTs}&interval=1d`;
  const res = await fetch(url, { cache: "force-cache", next: { revalidate: 3600 } });
  if (!res.ok) {
    return new Map();
  }
  const json = await res.json().catch(() => null as any);
  const result = json?.chart?.result?.[0];
  if (!result) return new Map();
  const ts: number[] = result.timestamp ?? [];
  const closes: number[] =
    (result.indicators?.adjclose?.[0]?.adjclose as number[] | undefined) ??
    (result.indicators?.quote?.[0]?.close as number[] | undefined) ??
    [];
  const map = new Map<number, number>();
  for (let i = 0; i < ts.length; i++) {
    const t = (ts[i] as number) | 0;
    const v = closes[i];
    if (v != null && Number.isFinite(v)) {
      // normalize to midnight UTC seconds
      const dayTs = Math.floor(t / DAY) * DAY;
      map.set(dayTs, Number(v));
    }
  }
  return map;
}

const DAY = 86400;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as HistoryRequest;
    const positions = (body?.positions ?? []).filter(Boolean);
    if (!positions.length) {
      return NextResponse.json({ points: [] });
    }

    const now = Math.floor(Date.now() / 1000);
    const minPurchase = positions
      .map((p) => (p.purchaseDate ? Math.floor(new Date(p.purchaseDate).getTime() / 1000) : undefined))
      .filter((x): x is number => typeof x === "number" && !Number.isNaN(x))
      .reduce<number | undefined>((acc, v) => (acc == null ? v : Math.min(acc, v)), undefined);
    const startTs =
      body?.startDate != null
        ? Math.floor(new Date(body.startDate).getTime() / 1000)
        : Math.max(0, (minPurchase ?? Math.floor(now - 90 * DAY)) - DAY);
    const endTs = body?.endDate ? Math.floor(new Date(body.endDate).getTime() / 1000) : now;

    // Gather non-money-market tickers
    const tickers = Array.from(
      new Set(
        positions
          .filter((p) => p.assetClass !== "Money Market")
          .map((p) => p.ticker.toUpperCase()),
      ),
    );

    // Fetch histories per ticker
    const histories: Record<string, Map<number, number>> = {};
    await Promise.all(
      tickers.map(async (sym) => {
        const map = await fetchYahooDaily(sym, startTs, endTs);
        histories[sym] = map;
      }),
    );

    // Build continuous daily timeline
    const points: HistoryPoint[] = [];
    for (let t = startTs; t <= endTs; t += DAY) {
      let total = 0;
      for (const p of positions) {
        const isMM = p.assetClass === "Money Market";
        if (p.purchaseDate) {
          const pTs = Math.floor(new Date(p.purchaseDate).getTime() / 1000);
          if (t < Math.floor(pTs / DAY) * DAY) continue;
        }
        if (isNaN(p.quantity as number)) continue;

        if (isMM) {
          const isCash = (p as any).ticker?.toUpperCase?.() === "CASH";
          if (isCash) {
            const bal =
              typeof p.costBasisPerUnit === "number" && p.costBasisPerUnit > 0
                ? p.costBasisPerUnit
                : Number(p.quantity) || 0;
            total += bal;
          } else {
            // Assume NAV ~ 1 for MMFs; quantity is balance
            total += Number(p.quantity) || 0;
          }
          continue;
        }

        const map = histories[p.ticker.toUpperCase()];
        if (!map || map.size === 0) continue;
        // forward-fill last known price up to this day
        // iterate back until we find a price <= t
        // to avoid O(N^2), precompute an array of sorted dates for this map
        // but for small N it's fine; optimize lightly
        let price: number | undefined = undefined;
        let dt = t;
        for (let back = 0; back < 7; back++) {
          if (map.has(dt)) {
            price = map.get(dt);
            break;
          }
          dt -= DAY;
          if (dt < startTs) break;
        }
        if (price != null) {
          total += (Number(p.quantity) || 0) * price;
        }
      }
      points.push({ t, v: Number(total.toFixed(2)) });
    }

    return NextResponse.json({ points });
  } catch (e: any) {
    return NextResponse.json({ points: [], error: String(e?.message ?? e) }, { status: 200 });
  }
}

