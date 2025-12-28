import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

export const runtime = "nodejs"; // yahoo-finance2 needs Node runtime
export const dynamic = "force-dynamic";

// v3+ usage: create an instance
const yahooFinance = new YahooFinance();

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

function isFridayAtOrBefore(d: Date) {
  return d.getDay() === 5; // Fri
}

// Returns the most recent Friday (<= date). Keeps time same, we only use date anyway.
function floorToFriday(date: Date): Date {
  const d = new Date(date);
  while (!isFridayAtOrBefore(d)) {
    d.setDate(d.getDate() - 1);
  }
  return d;
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

    // IMPORTANT: yahooFinance.historical requires period1 (cannot be undefined).
    // Fallback: 1 year ago if no start provided.
    const fallbackStart = new Date();
    fallbackStart.setFullYear(fallbackStart.getFullYear() - 1);
    const period1 = start ?? fallbackStart;

    // If user is requesting weekly-like behavior, we’ll filter to Fridays only client-side.
    // We still fetch 1d data from Yahoo for accuracy and then downsample.
    const effectiveInterval = interval === "1wk" ? "1d" : interval;

    const results = await Promise.all(
      tickers.map(async (ticker) => {
        // Use `any` to avoid Next/TS overload friction with yahoo-finance2 types.
        const opts: any = {
          period1,
          interval: effectiveInterval,
        };
        if (end) opts.period2 = end;

        const raw = (await yahooFinance.historical(ticker, opts)) as unknown;
        const rows: any[] = Array.isArray(raw) ? raw : [];

        const cleaned = rows
          .filter((r) => r?.date && typeof r?.close === "number" && Number.isFinite(r.close))
          .map((r) => ({
            date: new Date(r.date as any).toISOString().slice(0, 10), // YYYY-MM-DD
            close: Number(r.close),
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        // Weekly sampling: keep only Fridays (your “Friday close” model)
        let points = cleaned;
        if (interval === "1wk") {
          points = cleaned.filter((p) => {
            const d = new Date(p.date + "T12:00:00Z"); // stable day-of-week
            return d.getUTCDay() === 5; // Friday
          });

          // If we ended up with 0 points (rare), at least include the last available point
          if (points.length === 0 && cleaned.length > 0) {
            const last = cleaned[cleaned.length - 1];
            points = [last];
          }
        }

        // Monthly sampling: last Friday of each month
        if (interval === "1mo") {
          const byMonth = new Map<string, { date: string; close: number }[]>();
          for (const p of cleaned) {
            const ym = p.date.slice(0, 7); // YYYY-MM
            const arr = byMonth.get(ym) ?? [];
            arr.push(p);
            byMonth.set(ym, arr);
          }

          const monthly: { date: string; close: number }[] = [];
          for (const [ym, arr] of byMonth.entries()) {
            // pick last Friday in that month if present, else last trading day
            const fridays = arr.filter((p) => new Date(p.date + "T12:00:00Z").getUTCDay() === 5);
            const pick = (fridays.length ? fridays : arr)[(fridays.length ? fridays : arr).length - 1];
            if (pick) monthly.push(pick);
          }

          points = monthly.sort((a, b) => a.date.localeCompare(b.date));
        }

        return [ticker, points] as const;
      }),
    );

    const data = Object.fromEntries(results);

    return NextResponse.json({
      tickers,
      interval,
      start: period1.toISOString().slice(0, 10),
      end: end ? end.toISOString().slice(0, 10) : undefined,
      data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to fetch historical data", detail: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
