"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { fetchPortfolioSeries } from "@/lib/portfolioHistory";
import { fmtMoney, fmtNumber } from "@/lib/format";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type ChartMode = "dollar" | "percent";
type Timeframe = "all" | "1m" | "1y";

type HistoryPoint = { date: string; close: number };
type HistoryResponse = {
  tickers: string[];
  interval: "1d" | "1wk" | "1mo";
  start?: string;
  end?: string;
  data: Record<string, HistoryPoint[]>;
};

function fmtSignedPct(n: number, decimals = 2) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${fmtNumber(n, decimals)}%`;
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

function TimeframePills(props: { value: Timeframe; onChange: (v: Timeframe) => void }) {
  const { value, onChange } = props;

  const pillBase = "px-4 py-2 rounded-full text-sm font-semibold transition border";
  const active = "bg-black text-white border-black";
  const inactive = "bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200";

  return (
    <div className="flex items-center gap-2">
      <button type="button" className={`${pillBase} ${value === "all" ? active : inactive}`} onClick={() => onChange("all")}>
        All
      </button>
      <button type="button" className={`${pillBase} ${value === "1m" ? active : inactive}`} onClick={() => onChange("1m")}>
        1M
      </button>
      <button type="button" className={`${pillBase} ${value === "1y" ? active : inactive}`} onClick={() => onChange("1y")}>
        1Y
      </button>
    </div>
  );
}

function MetricCard(props: {
  title: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  valueClassName?: string;
  subValueClassName?: string;
}) {
  const { title, value, subValue, valueClassName, subValueClassName } = props;

  return (
    <Card className="h-full">
      <CardContent className="p-5">
        <p className="text-sm font-medium text-gray-600">{title}</p>

        {/* Step 2: fixed/min height + vertically centered value block so all KPI cards align */}
        <div className="mt-3 min-h-[52px] flex flex-col justify-center">
          <div className={`text-2xl font-semibold tracking-tight leading-none text-gray-900 ${valueClassName ?? ""}`}>
            {value}
          </div>

          {subValue ? (
            <div className={`mt-1 text-sm font-medium leading-none ${subValueClassName ?? "text-gray-600"}`}>{subValue}</div>
          ) : (
            // keep spacing consistent for cards without a subValue
            <div className="mt-1 h-[14px]" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function OverviewTab() {
  const { state, diversificationScore } = usePortfolioState();

  const [mode, setMode] = useState<ChartMode>("dollar");
  const [timeframe, setTimeframe] = useState<Timeframe>("all");
  const [showBenchmark, setShowBenchmark] = useState(true);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySeries, setHistorySeries] = useState<{ date: string; value: number; breakdown?: Record<string, number> }[]>([]);
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
        const series = await fetchPortfolioSeries({
          positions: state.positions,
          profile: state.profile,
          interval: "1d",
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
  }, [state.positions, state.profile, reloadNonce]);

  const cutoffISO = useMemo(() => {
    const end = todayISO();
    if (timeframe === "1m") return addDaysISO(end, -30);
    if (timeframe === "1y") return addDaysISO(end, -365);
    return undefined;
  }, [timeframe]);

  const filteredHistorySeries = useMemo(() => {
    if (!cutoffISO) return historySeries;

    const filtered = historySeries.filter((p) => p.date >= cutoffISO);
    if (filtered.length >= 2) return filtered;
    if (historySeries.length >= 2) return historySeries.slice(-2);
    return filtered;
  }, [historySeries, cutoffISO]);

  useEffect(() => {
    const benchReqId = ++benchReqIdRef.current;

    async function runBench() {
      if (!showBenchmark || filteredHistorySeries.length < 2) {
        if (benchReqId !== benchReqIdRef.current) return;
        setBenchSeries([]);
        setBenchLoading(false);
        return;
      }

      const start = filteredHistorySeries[0].date;
      const end = filteredHistorySeries[filteredHistorySeries.length - 1].date;

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
  }, [filteredHistorySeries, showBenchmark]);

  const { kpis, chartData, yDomain, updates, killer, periodLabel } = useMemo(() => {
    const totalValue = state.positions.reduce((acc, p) => {
      const unit =
        typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice) ? p.currentPrice : p.costBasisPerUnit;
      return acc + (Number(p.quantity) || 0) * (Number(unit) || 0);
    }, 0);

    const totalCost = state.positions.reduce(
      (acc, p) => acc + (Number(p.quantity) || 0) * (Number(p.costBasisPerUnit) || 0),
      0
    );

    const unrealized = totalValue - totalCost;

    const fullBaseline = historySeries.length ? historySeries[0].value : 0;
    const fullLast = historySeries.length ? historySeries.at(-1)!.value : 0;
    const sinceStartDollar = fullBaseline > 0 ? fullLast - fullBaseline : 0;
    const sinceStartPercent = fullBaseline > 0 ? (sinceStartDollar / fullBaseline) * 100 : 0;

    const periodChange =
      historySeries.length >= 2
        ? ((historySeries.at(-1)!.value - historySeries.at(-2)!.value) / Math.max(historySeries.at(-2)!.value, 1)) * 100
        : 0;

    const periodLabel = "1-Day Change";

    const chartBaseline = filteredHistorySeries.length ? filteredHistorySeries[0].value : 0;

    const benchArr = benchSeries.slice().sort((a, b) => a.date.localeCompare(b.date));
    const benchFirstClose = benchArr.length ? benchArr[0].close : 0;

    let lastBenchClose: number | undefined = undefined;
    let benchIdx = 0;

    const aligned = filteredHistorySeries.map((p) => {
      while (benchIdx < benchArr.length && benchArr[benchIdx].date <= p.date) {
        lastBenchClose = benchArr[benchIdx].close;
        benchIdx++;
      }

      const portfolioDollar = Number(p.value.toFixed(2));
      const portfolioPct = chartBaseline > 0 ? Number((((p.value / chartBaseline) - 1) * 100).toFixed(4)) : 0;

      const benchClose = typeof lastBenchClose === "number" ? lastBenchClose : undefined;
      const benchPct = showBenchmark && benchClose && benchFirstClose > 0 ? ((benchClose / benchFirstClose) - 1) * 100 : 0;

      const benchDollarIndexed =
        showBenchmark && benchClose && benchFirstClose > 0 && chartBaseline > 0
          ? chartBaseline * (benchClose / benchFirstClose)
          : 0;

      return {
        d: p.date,
        v: mode === "dollar" ? portfolioDollar : portfolioPct,
        b: mode === "dollar" ? Number(benchDollarIndexed.toFixed(2)) : Number(benchPct.toFixed(4)),
        breakdown: p.breakdown ?? {},
        totalDollar: portfolioDollar,
        benchDollar: Number(benchDollarIndexed.toFixed(2)),
        benchPct: Number(benchPct.toFixed(4)),
      };
    });

    const vals = aligned.flatMap((d) => (showBenchmark ? [d.v, d.b] : [d.v])).filter((n) => Number.isFinite(n));
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

    const updates =
      historySeries.length < 2
        ? []
        : [
            `Latest: Your portfolio ${periodChange >= 0 ? "gained" : "fell"} ${fmtNumber(Math.abs(periodChange), 2)}% (1 day).`,
            `Diversification score: ${diversificationScore}/100.`,
          ];

    const killer = (() => {
      if (!state.positions.length) return null;

      const rows = state.positions
        .map((p) => {
          const current =
            typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice) ? p.currentPrice : p.costBasisPerUnit;
          const cost = Number(p.costBasisPerUnit) || 0;
          const qty = Number(p.quantity) || 0;
          const pnl = (current - cost) * qty;
          return { ticker: p.ticker, pnl };
        })
        .filter((r) => r.ticker);

      if (!rows.length) return null;

      rows.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
      const top = rows[0];

      return {
        ticker: top.ticker,
        pnl: top.pnl,
        dir: top.pnl >= 0 ? "gains" : "losses",
      };
    })();

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
      killer,
      periodLabel,
    };
  }, [state.positions, diversificationScore, historySeries, filteredHistorySeries, mode, benchSeries, showBenchmark]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Portfolio Value" value={fmtMoney(kpis.totalValue)} />

        <MetricCard
          title="Unrealized Gain/Loss"
          value={
            <>
              {kpis.unrealized >= 0 ? "+" : ""}
              {fmtMoney(kpis.unrealized)}
            </>
          }
          valueClassName={kpis.unrealized >= 0 ? "text-emerald-600" : "text-red-600"}
        />

        <MetricCard
          title="Since Start (Gain/Loss)"
          value={
            <>
              {kpis.sinceStartDollar >= 0 ? "+" : ""}
              {fmtMoney(kpis.sinceStartDollar)}
            </>
          }
          valueClassName={kpis.sinceStartDollar >= 0 ? "text-emerald-600" : "text-red-600"}
          subValue={fmtSignedPct(kpis.sinceStartPercent, 2)}
          subValueClassName={kpis.sinceStartPercent >= 0 ? "text-emerald-600" : "text-red-600"}
        />

        <MetricCard
          title={periodLabel}
          value={fmtSignedPct(kpis.dayChange, 2)}
          valueClassName={kpis.dayChange >= 0 ? "text-emerald-600" : "text-red-600"}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <TimeframePills value={timeframe} onChange={setTimeframe} />

          <label className="flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-sm text-gray-700 select-none">
            <input type="checkbox" className="h-4 w-4" checked={showBenchmark} onChange={(e) => setShowBenchmark(e.target.checked)} />
            <span className="font-medium">S&amp;P 500</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
                  tickFormatter={(v: number) => (mode === "dollar" ? fmtMoney(v) : `${fmtNumber(v, 1)}%`)}
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

                    return (
                      <div className="rounded-md border bg-white p-3 text-sm shadow-md">
                        <div className="font-medium mb-1">{formatTooltipDate(point.d)}</div>

                        <div className="space-y-1 mb-2">
                          <div className="flex justify-between gap-6">
                            <span className="text-gray-600">Portfolio</span>
                            <span className="font-semibold">
                              {mode === "dollar" ? fmtMoney(point.totalDollar) : `${fmtNumber(point.v, 2)}%`}
                            </span>
                          </div>

                          {showBenchmark && (
                            <div className="flex justify-between gap-6">
                              <span className="text-gray-600">S&amp;P 500 (SPY)</span>
                              <span className="font-semibold">
                                {mode === "dollar" ? fmtMoney(point.benchDollar) : `${fmtNumber(point.benchPct, 2)}%`}
                              </span>
                            </div>
                          )}
                        </div>

                        {mode === "dollar" && entries.length > 0 && (
                          <div className="pt-2 border-t space-y-1">
                            {entries.map(([k, v]) => (
                              <div key={k} className="flex justify-between gap-6">
                                <span className="text-gray-600">{k}</span>
                                <span className="font-mono">{fmtMoney(v, 0)}</span>
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

                <Line type="monotone" dataKey="v" stroke="#2563eb" strokeWidth={2} dot={false} />
                {showBenchmark && (
                  <Line type="monotone" dataKey="b" stroke="#111827" strokeWidth={2} strokeDasharray="6 6" dot={false} isAnimationActive={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}

          {showBenchmark && benchLoading && <p className="mt-2 text-xs text-gray-500">Loading benchmark (SPY)…</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="text-sm font-medium text-gray-600">Killer Insight</div>

          {killer ? (
            <div className="mt-2 text-sm text-gray-900">
              <span className="font-semibold">{killer.ticker}</span> is your biggest driver of {killer.dir} right now (
              <span className={killer.pnl >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                {killer.pnl >= 0 ? "+" : ""}
                {fmtMoney(killer.pnl)}
              </span>
              ). <span className="text-gray-600">If you want a smoother ride, reduce single-name concentration over time.</span>
            </div>
          ) : (
            <div className="mt-2 text-sm text-gray-600">Add positions to see your biggest return driver.</div>
          )}
        </CardContent>
      </Card>

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
