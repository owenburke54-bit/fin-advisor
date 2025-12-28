import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ✅ v3+ expects you to instantiate
const yahooFinance = new YahooFinance();

function parseDateParam(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function clampStart(start?: Date): Date | undefined {
  if (!start) return undefined;
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  return start < tenYearsAgo ? tenYearsAgo : start;
}

type Point = { date: string; close: number };

/**
 * Pick one point per week: Friday close (proxy for "Friday 4pm").
 * If a week has no Friday (holiday / missing data), we fall back to the latest day that week.
 */
function downsampleToWeekly(rows: { date: Date; close: number }[]): Point[] {
  // Group by ISO week key (YYYY-WW) using UTC dates
  const weekKey = (d: Date) => {
    const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    // ISO week calc
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${dt.getUTCFullYear()}-${String(weekNo).padStart(2, "0")}`;
  };

  const byWeek = new Map<string, { date: Date; close: number }[]>();
  for (const r of rows) {
    const key = weekKey(r.date);
    const arr = byWeek.get(key) ?? [];
    arr.push(r);
    byWeek.set(key, arr);
  }

  const out: Point[] = [];
  const keys = Array.from(byWeek.keys()).sort((a, b) => a.localeCompare(b));

  for (const key of keys) {
    const arr = (byWeek.get(key) ?? []).slice().sort((a, b) => a.date.getTime() - b.date.getTime());
    // Prefer Friday (UTC day 5), else last available day in that week
    const friday = arr.filter((x) => x.date.getUTCDay() === 5).at(-1);
    const chosen = friday ?? arr.at(-1);
    if (!chosen) continue;

    out.push({
      date: chosen.date.toISOString().slice(0, 10),
      close: Number(chosen.close),
    });
  }

  return out;
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

    // We’ll still accept 1d / 1wk / 1mo from the client,
    // but "weekly" will be enforced by downsampling Friday closes.
    const interval = (searchParams.get("interval") || "1d") as "1d" | "1wk" | "1mo";

    const startRaw = parseDateParam(searchParams.get("start"));
    const endRaw = parseDateParam(searchParams.get("end"));

    const start = clampStart(startRaw);
    const end = endRaw;

    const results = await Promise.all(
      tickers.map(async (ticker) => {
        // ✅ Build options without undefined (fixes TS overload error)
        const opts: Record<string, any> = { interval: "1d" }; // always fetch daily, then downsample ourselves
        if (start) opts.period1 = start;
        if (end) opts.period2 = end;

        const raw = (await yahooFinance.historical(ticker, opts)) as unknown;
        const rows: any[] = Array.isArray(raw) ? raw : [];

        const cleaned = rows
          .filter(
            (r) =>
              r?.date &&
              r.date instanceof Date &&
              typeof r?.close === "number" &&
              Number.isFinite(r.close),
          )
          .map((r) => ({ date: r.date as Date, close: Number(r.close) }))
          .sort((a, b) => a.date.getTime() - b.date.getTime());

        const points =
          interval === "1wk"
            ? downsampleToWeekly(cleaned)
            : interval === "1mo"
              ? downsampleToWeekly(cleaned) // (simple + light) keep it weekly for now; monthly can be done next
              : cleaned.map((r) => ({
                  date: r.date.toISOString().slice(0, 10),
                  close: Number(r.close),
                }));

        return [ticker, points] as const;
      }),
    );

    const data = Object.fromEntries(results);

    return NextResponse.json({
      tickers,
      interval,
      start: start ? start.toISOString().slice(0, 10) : undefined,
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
