"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { fetchPortfolioSeries } from "@/lib/portfolioHistory";
import { isBondLike, isCashLike, isEquityLike, targetMixForRisk } from "@/lib/types";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type Resolution = "daily" | "weekly" | "monthly";
type ChartMode = "dollar" | "percent";

type HistoryPoint = { date: string; close: number };
type HistoryResponse = {
  tickers: string[];
  interval: "1d" | "1wk" | "1mo";
  start?: string;
  end?: string;
  data: Record<string, HistoryPoint[]>;
};

function fmtDollar(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPct(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function formatAxisDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTooltipDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function fetchHistoryTicker(opts: {
  ticker: string;
  start: string;
  end: string;
  interval: "1d" | "1wk" | "1mo";
  timeoutMs?: number;
}): Promise<HistoryPoint[]> {
  const { ticker, start, end, interval, timeoutMs = 12000 } = opts;

  const qs = new URLSearchParams();
  qs.set("tickers", ticker);
  qs.set("start", start);
  qs.set("end", end);
  qs.set("interval", interval);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`/api/history?${qs.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return [];

    const json = (await res.json()) as HistoryResponse;
    const series = (json?.data?.[ticker] ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    return series;
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export default function OverviewTab() {
  const { state, diversificationScore } = usePortfolioState();
  const [res, setRes] = useState<Resolution>("daily");
  const [mode, setMode] = useState<ChartMode>("dollar");

  // ✅ NEW: toggle for showing benchmark line
  const [showBenchmark, setShowBenchmark] = useState(true);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySeries, setHistorySeries] = useState<
    {
      date: string;
      value: number;
      breakdown?: Record<string, number>;
    }[]
  >([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [benchLoading, setBenchLoading] = useState(false);
  const [benchSeries, setBenchSeries] = useState<{ date: string; close: number }[]>([]);

  const [reloadNonce, setReloadNonce] = useState(0);

  const reqIdRef = useRef(0);
  const benchReqIdRef = useRef(0);

  useEffect(() => {
    const reqId = ++reqIdRef.current;

    async function run() {
      if (!state.positions.length) {
        if (reqId !== reqIdRef.current) return;
        setHistorySeries([]);
        setHistoryError(null);
        setHistoryLoading(false);
        return;
      }

      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const interval = res === "daily" ? "1d" : res === "weekly" ? "1wk" : "1mo";

        const series = await fetchPortfolioSeries({
          positions: state.positions,
          profile: state.profile,
          interval,
        });

        if (reqId !== reqIdRef.current) return;
        setHistorySeries(series);
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setHistoryError(e instanceof Error ? e.message : "Failed to load historical data");
        setHistorySeries([]);
      } finally {
        if (reqId !== reqIdRef.current) return;
        setHistoryLoading(false);
      }
    }

    void run();
  }, [state.positions, state.profile, res, reloadNonce]);

  // ✅ Fetch benchmark only when toggle is ON
  useEffect(() => {
    const benchReqId = ++benchReqIdRef.current;

    async function runBench() {
      if (!showBenchmark || historySeries.length < 2) {
        if (benchReqId !== benchReqIdRef.current) return;
        setBenchSeries([]);
        setBenchLoading(false);
        return;
      }

      const start = historySeries[0].date;
      const end = historySeries[historySeries.length - 1].date;

      setBenchLoading(true);

      const raw = await fetchHistoryTicker({
        ticker: "SPY",
        start,
        end,
        interval: "1d",
      });

      if (benchReqId !== benchReqIdRef.current) return;

      setBenchSeries(raw);
      setBenchLoading(false);
    }

    void runBench();
  }, [historySeries, showBenchmark]);

  const { kpis, chartData, yDomain, updates, riskAlignment, periodLabel } = useMemo(() => {
    const totalValue = state.positions.reduce((acc, p) => {
      const unit =
        typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
          ? p.currentPrice
          : p.costBasisPerUnit;
      return acc + (Number(p.quantity) || 0) * (Number(unit) || 0);
    }, 0);

    const totalCost = state.positions.reduce(
      (acc, p) => acc + (Number(p.quantity) || 0) * (Number(p.costBasisPerUnit) || 0),
      0,
    );

    const unrealized = totalValue - totalCost;

    const baseline = historySeries.length ? historySeries[0].value : 0;
    const lastHist = historySeries.length ? historySeries.at(-1)!.value : 0;

    const sinceStartDollar = baseline > 0 ? lastHist - baseline : 0;
    const sinceStartPercent = baseline > 0 ? (sinceStartDollar / baseline) * 100 : 0;

    const periodChange =
      historySeries.length >= 2
        ? ((historySeries.at(-1)!.value - historySeries.at(-2)!.value) /
            Math.max(historySeries.at(-2)!.value, 1)) *
          100
        : 0;

    const baseForPct = baseline > 0 ? baseline : 0;

    // Benchmark baseline close (first available)
    const benchArr = benchSeries.slice().sort((a, b) => a.date.localeCompare(b.date));
    const benchFirstClose = benchArr.length ? benchArr[0].close : 0;

    // align benchmark closes to portfolio dates via forward-fill
    let lastBenchClose: number | undefined = undefined;
    let benchIdx = 0;

    const aligned = historySeries.map((p) => {
      while (benchIdx < benchArr.length && benchArr[benchIdx].date <= p.date) {
        lastBenchClose = benchArr[benchIdx].close;
        benchIdx++;
      }

      const dollar = Number(p.value.toFixed(2));
      const percent = baseForPct > 0 ? Number((((p.value / baseForPct) - 1) * 100).toFixed(4)) : 0;

      const benchClose = typeof lastBenchClose === "number" ? lastBenchClose : undefined;
      const benchReturnPct =
        showBenchmark && benchClose && benchFirstClose > 0 ? ((benchClose / benchFirstClose) - 1) * 100 : 0;

      const benchIndexedDollar =
        showBenchmark && benchClose && benchFirstClose > 0 && baseline > 0 ? baseline * (benchClose / benchFirstClose) : 0;

      const benchValue =
        mode === "dollar" ? Number(benchIndexedDollar.toFixed(2)) : Number(benchReturnPct.toFixed(4));

      return {
        d: p.date,
        v: mode === "dollar" ? dollar : percent,
        b: benchValue,
        breakdown: p.breakdown ?? {},
        totalDollar: dollar,
        benchDollar: Number(benchIndexedDollar.toFixed(2)),
        benchPct: Number(benchReturnPct.toFixed(4)),
      };
    });

    // Domain uses benchmark too only if enabled
    const vals = aligned
      .flatMap((d) => (showBenchmark ? [d.v, d.b] : [d.v]))
      .filter((n) => Number.isFinite(n));

    const yMin = vals.length ? Math.min(...vals) : 0;
    const yMax = vals.length ? Math.max(...vals) : 0;
    const range = yMax - yMin;

    const pad =
      range > 0
        ? range * 0.12
        : mode === "dollar"
          ? Math.max(10, Math.abs(yMin) * 0.01)
          : Math.max(0.5, Math.abs(yMin) * 0.05);

    const yDomain: [number, number] = [yMin - pad, yMax + pad];

    const totals = state.positions.reduce(
      (acc, p) => {
        const v =
          (typeof p.currentPrice === "number" ? p.currentPrice : p.costBasisPerUnit) * p.quantity;

        if (isEquityLike(p.assetClass)) acc.equity += v;
        else if (isBondLike(p.assetClass)) acc.bonds += v;
        else if (isCashLike(p.assetClass)) acc.cash += v;
        else acc.equity += v;
        acc.total += v;
        return acc;
      },
      { equity: 0, bonds: 0, cash: 0, total: 0 },
    );

    const target = targetMixForRisk(state.profile?.riskLevel ?? 3);
    const deltaEquity = totals.total
      ? Math.round(((totals.equity / totals.total) - target.equity) * 100)
      : 0;

    const alignmentText =
      totals.total === 0
        ? "No positions yet"
        : deltaEquity > 10
          ? "More aggressive than target"
          : deltaEquity < -10
            ? "More conservative than target"
            : "Roughly aligned with target";

    const updates =
      historySeries.length < 2
        ? []
        : [
            `Latest: Your portfolio ${periodChange >= 0 ? "gained" : "fell"} ${Math.abs(periodChange).toFixed(2)}% (${res}).`,
            `Diversification score: ${diversificationScore}/100.`,
          ];

    const periodLabel =
      res === "daily" ? "1-Day Change" : res === "weekly" ? "1-Week Change" : "1-Month Change";

    return {
      kpis: {
        totalValue,
        unrealized,
        dayChange: periodChange,
        sinceStartDollar,
        sinceStartPercent,
      },
      chartData: aligned,
      yDomain,
      updates,
      riskAlignment: alignmentText,
      periodLabel,
    };
  }, [state.positions, state.profile?.riskLevel, diversificationScore, historySeries, res, mode, benchSeries, showBenchmark]);

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-500">Total Portfolio Value</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">${kpis.totalValue.toFixed(2)}</CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-500">Unrealized Gain/Loss</CardTitle>
          </CardHeader>
          <CardContent
            className={`text-2xl font-semibold ${kpis.unrealized >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {kpis.unrealized >= 0 ? "+" : ""}
            ${kpis.unrealized.toFixed(2)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-500">Since Start (Gain/Loss)</CardTitle>
          </CardHeader>
          <CardContent
            className={`text-2xl font-semibold ${kpis.sinceStartDollar >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {kpis.sinceStartDollar >= 0 ? "+" : ""}
            ${kpis.sinceStartDollar.toFixed(2)} ({kpis.sinceStartPercent.toFixed(2)}%)
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex items-center justify-between">
            <CardTitle className="text-sm text-gray-500">{periodLabel}</CardTitle>
            <Badge variant="secondary">{riskAlignment}</Badge>
          </CardHeader>
          <CardContent
            className={`text-2xl font-semibold ${kpis.dayChange >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {kpis.dayChange >= 0 ? "+" : ""}
            {kpis.dayChange.toFixed(2)}%
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            <Button variant={res === "daily" ? "default" : "secondary"} onClick={() => setRes("daily")}>
              Daily
            </Button>
            <Button variant={res === "weekly" ? "default" : "secondary"} onClick={() => setRes("weekly")}>
              Weekly
            </Button>
            <Button variant={res === "monthly" ? "default" : "secondary"} onClick={() => setRes("monthly")}>
              Monthly
            </Button>
          </div>

          {/* ✅ Checkbox between Monthly and $ */}
          <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={showBenchmark}
              onChange={(e) => setShowBenchmark(e.target.checked)}
            />
            S&amp;P 500
          </label>
        </div>

        <div className="flex gap-2 items-center">
          <Button variant={mode === "dollar" ? "default" : "secondary"} onClick={() => setMode("dollar")}>
            $
          </Button>
          <Button variant={mode === "percent" ? "default" : "secondary"} onClick={() => setMode("percent")}>
            %
          </Button>

          <Button variant="secondary" onClick={() => setReloadNonce((n) => n + 1)} disabled={historyLoading}>
            {historyLoading ? "Loading..." : "Reload Chart"}
          </Button>
        </div>
      </div>

      {/* Chart */}
      <Card>
        <CardContent className="h-[260px] pt-6">
          {historyError ? (
            <p className="text-sm text-red-600">{historyError}</p>
          ) : historyLoading && chartData.length === 0 ? (
            <p className="text-sm text-gray-600">Loading historical portfolio chart…</p>
          ) : chartData.length < 2 ? (
            <p className="text-sm text-gray-600">Add positions (with purchase dates) to see historical trend.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="4 4" />
                <XAxis dataKey="d" tickMargin={8} minTickGap={28} tickFormatter={formatAxisDate} />
                <YAxis
                  domain={yDomain}
                  tickFormatter={(v: number) => (mode === "dollar" ? fmtDollar(v) : `${v.toFixed(1)}%`)}
                />

                <ReTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;

                    const point = payload[0].payload as {
                      d: string;
                      v: number;
                      b: number;
                      breakdown: Record<string, number>;
                      totalDollar: number;
                      benchDollar: number;
                      benchPct: number;
                    };

                    const entries = Object.entries(point.breakdown || {});
                    entries.sort((a, b) => b[1] - a[1]);
                    const cashIdx = entries.findIndex(([k]) => k === "Cash");
                    if (cashIdx >= 0) {
                      const cash = entries.splice(cashIdx, 1)[0];
                      entries.push(cash);
                    }

                    return (
                      <div className="rounded-md border bg-white p-3 text-sm shadow-md">
                        <div className="font-medium mb-1">{formatTooltipDate(point.d)}</div>

                        <div className="space-y-1 mb-2">
                          <div className="flex justify-between gap-6">
                            <span className="text-gray-600">Portfolio</span>
                            <span className="font-semibold">
                              {mode === "dollar" ? fmtDollar(point.totalDollar) : fmtPct(point.v)}
                            </span>
                          </div>

                          {showBenchmark && (
                            <div className="flex justify-between gap-6">
                              <span className="text-gray-600">S&amp;P 500 (SPY)</span>
                              <span className="font-semibold">
                                {mode === "dollar" ? fmtDollar(point.benchDollar) : fmtPct(point.benchPct)}
                              </span>
                            </div>
                          )}
                        </div>

                        {mode === "dollar" && entries.length > 0 && (
                          <div className="pt-2 border-t space-y-1">
                            {entries.map(([k, v]) => (
                              <div key={k} className="flex justify-between gap-6">
                                <span className="text-gray-600">{k}</span>
                                <span className="font-mono">${v.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {mode === "percent" && (
                          <div className="pt-2 border-t text-xs text-gray-500">
                            Tip: switch to <span className="font-medium">$</span> to see ticker breakdown.
                          </div>
                        )}
                      </div>
                    );
                  }}
                />

                {/* Portfolio line */}
                <Line type="monotone" dataKey="v" stroke="#2563eb" strokeWidth={2} dot={false} />

                {/* Benchmark line (dashed) */}
                {showBenchmark && (
                  <Line
                    type="monotone"
                    dataKey="b"
                    stroke="#111827"
                    strokeWidth={2}
                    strokeDasharray="6 6"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}

          {showBenchmark && benchLoading && (
            <p className="mt-2 text-xs text-gray-500">Loading benchmark (SPY)…</p>
          )}
        </CardContent>
      </Card>

      {/* Updates */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Updates</CardTitle>
        </CardHeader>
        <CardContent>
          {updates.length === 0 ? (
            <p className="text-sm text-gray-600">Add positions (with purchase dates) to see updates.</p>
          ) : (
            <ul className="space-y-2">
              {updates.map((u, i) => (
                <li key={i} className="text-sm">
                  {u}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
