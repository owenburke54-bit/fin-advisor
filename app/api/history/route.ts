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

    const results = await Promise.all(
      tickers.map(async (ticker) => {
        // Build options without undefined values (fixes TS overload error)
        const options: Record<string, string | number | Date> = { interval };
        if (start) options.period1 = start;
        if (end) options.period2 = end;

        const raw = (await yahooFinance.historical(ticker, options as any)) as unknown;
        const rows: any[] = Array.isArray(raw) ? raw : [];

        const points = rows
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
