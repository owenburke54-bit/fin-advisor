"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { fetchPortfolioSeries } from "@/lib/portfolioHistory";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { cashFlowsFromTransactions, twr, xirr, xirrCashFlowsWithTerminalValue } from "@/lib/performance";
import { annualizedVolatility, betaFromReturnSeries, dailyReturns, maxDrawdown } from "@/lib/risk";
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
    const res = await fetch(`/api/history?${qs.toString()}`, { cache: "no-store", signal: controller.signal });
    if (!res.ok) return [];

    const json = (await res.json()) as HistoryResponse;
    return (json?.data?.[ticker] ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
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

/** consistent value block height so cards align */
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
        <div className="mt-3 min-h-[52px] flex flex-col justify-center">
          <div className={`text-2xl font-semibold tracking-tight text-gray-900 leading-none ${valueClassName ?? ""}`}>
            {value}
          </div>
          {subValue ? (
            <div className={`mt-2 text-sm font-medium leading-none ${subValueClassName ?? "text-gray-600"}`}>
              {subValue}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** "Nice" Y-axis ticks (rounded numbers) */
function niceTicks(min: number, max: number, count: number, mode: ChartMode): { ticks: number[]; domain: [number, number] } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 2) return { ticks: [0, 1], domain: [0, 1] };
  if (min === max) {
    const pad = mode === "dollar" ? Math.max(10, Math.abs(min) * 0.02) : Math.max(0.5, Math.abs(min) * 0.1);
    return niceTicks(min - pad, max + pad, count, mode);
  }

  const span = Math.abs(max - min);
  const rawStep = span / (count - 1);
  const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const scaled = rawStep / pow10;

  let stepMult = 1;
  if (scaled <= 1) stepMult = 1;
  else if (scaled <= 2) stepMult = 2;
  else if (scaled <= 5) stepMult = 5;
  else stepMult = 10;

  let step = stepMult * pow10;

  if (mode === "percent") {
    if (step < 0.5) step = 0.5;
    if (step > 25) step = 25;
  }

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Number(v.toFixed(10)));

  return { ticks, domain: [niceMin, niceMax] };
}

type TxLike = { type?: string; date?: string; amount?: number };

function isExternalCashTx(t: TxLike): boolean {
  return t?.type === "CASH_DEPOSIT" || t?.type === "CASH_WITHDRAWAL";
}

/**
 * Net contributions (for display): deposits positive, withdrawals negative
 */
function sumNetContributions(transactions: TxLike[], cutoffISO?: string, terminalISO?: string): number {
  const txs = Array.isArray(transactions) ? transactions : [];
  return txs
    .filter(isExternalCashTx)
    .filter((t) => typeof t?.date === "string")
    .filter((t) => (!cutoffISO ? true : (t.date as string) >= cutoffISO))
    .filter((t) => (!terminalISO ? true : (t.date as string) <= terminalISO))
    .reduce((acc, t) => {
      const amt = Number(t?.amount ?? 0);
      if (!Number.isFinite(amt)) return acc;
      return acc + (t.type === "CASH_WITHDRAWAL" ? -Math.abs(amt) : Math.abs(amt));
    }, 0);
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
        const series = await fetchPortfolioSeries({ positions: state.positions, profile: state.profile, interval: "1d" });
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
      const raw = await fetchHistoryTicker({ ticker: "SPY", start, end, interval: "1d" });

      if (benchReqId !== benchReqIdRef.current) return;
      setBenchSeries(raw);
      setBenchLoading(false);
    }

    void runBench();
  }, [filteredHistorySeries, showBenchmark]);

  const { kpis, chartData, yAxis, updates, killer, periodLabel } = useMemo(() => {
    const totalValue = state.positions.reduce((acc, p) => {
      const unit =
        typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice) ? p.currentPrice : p.costBasisPerUnit;
      return acc + (Number(p.quantity) || 0) * (Number(unit) || 0);
    }, 0);

    const totalCost = state.positions.reduce((acc, p) => acc + (Number(p.quantity) || 0) * (Number(p.costBasisPerUnit) || 0), 0);
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
      const benchPct = showBenchmark && benchClose && benchFirstClose > 0 ? ((benchClose / benchFirstClose) - 1) * 100 : undefined;

      const benchDollarIndexed =
        showBenchmark && benchClose && benchFirstClose > 0 && chartBaseline > 0 ? chartBaseline * (benchClose / benchFirstClose) : undefined;

      return {
        d: p.date,
        v: mode === "dollar" ? portfolioDollar : portfolioPct,
        b:
          mode === "dollar"
            ? typeof benchDollarIndexed === "number"
              ? Number(benchDollarIndexed.toFixed(2))
              : null
            : typeof benchPct === "number"
              ? Number(benchPct.toFixed(4))
              : null,
        breakdown: p.breakdown ?? {},
        totalDollar: portfolioDollar,
        benchDollar: typeof benchDollarIndexed === "number" ? Number(benchDollarIndexed.toFixed(2)) : null,
        benchPct: typeof benchPct === "number" ? Number(benchPct.toFixed(4)) : null,
      };
    });

    const vals = aligned
      .flatMap((d) => (showBenchmark ? [d.v, d.b] : [d.v]))
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

    const yMin = vals.length ? Math.min(...vals) : 0;
    const yMax = vals.length ? Math.max(...vals) : 0;

    const range = yMax - yMin;
    const pad =
      range > 0
        ? range * (timeframe === "1m" ? 0.08 : 0.12)
        : mode === "dollar"
          ? Math.max(10, Math.abs(yMin) * 0.01)
          : Math.max(0.5, Math.abs(yMin) * 0.05);

    const { ticks, domain } = niceTicks(yMin - pad, yMax + pad, 5, mode);

    // ---- True performance (timeframe-aware) ----
    const flowsAll = cashFlowsFromTransactions(state.transactions ?? []);
    const perfSeries = filteredHistorySeries.map((p) => ({ date: p.date, value: p.value }));

    const terminalValue = perfSeries.length ? perfSeries.at(-1)!.value : totalValue;
    const terminalDate = perfSeries.length ? perfSeries.at(-1)!.date : todayISO();

    const flowsTf = flowsAll
      .filter((f) => typeof f?.date === "string" && typeof f?.amount === "number")
      .filter((f) => (!cutoffISO ? true : f.date >= cutoffISO))
      .filter((f) => f.date <= terminalDate);

    const twrValue = perfSeries.length >= 2 ? twr(perfSeries, flowsTf) : null; // cumulative fraction
    const irrFlows = xirrCashFlowsWithTerminalValue(flowsTf, terminalDate, terminalValue);
    const xirrValue = xirr(irrFlows); // annualized fraction

    const netContrib = sumNetContributions(state.transactions ?? [], cutoffISO, terminalDate);

    // ---- Contribution vs Market Growth (timeframe-aware) ----
    const tfStartValue = perfSeries.length ? perfSeries[0].value : 0;
    const tfEndValue = perfSeries.length ? perfSeries.at(-1)!.value : 0;
    const tfTotalChange = tfEndValue - tfStartValue;
    const tfMarketGrowth = tfTotalChange - netContrib;

    const timeframeLabel = timeframe === "1m" ? " (1M)" : timeframe === "1y" ? " (1Y)" : " (All)";

    const updates =
      historySeries.length < 2
        ? []
        : [
            `Latest: Your portfolio ${periodChange >= 0 ? "gained" : "fell"} ${fmtNumber(Math.abs(periodChange), 2)}% (1 day).`,
            `Diversification score: ${diversificationScore}/100.`,
            ...(typeof twrValue === "number" ? [`True return (TWR)${timeframeLabel}: ${fmtSignedPct(twrValue * 100, 2)}.`] : []),
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

      return { ticker: top.ticker, pnl: top.pnl, dir: top.pnl >= 0 ? "gains" : "losses" };
    })();

    const hasAnyTx = Array.isArray(state.transactions) && state.transactions.length > 0;
    const hasAnyFlow = flowsAll.some((f) => Number(f?.amount) !== 0);

    // ---- Risk metrics (computed off aligned dollars) ----
    const portSeriesForRisk = aligned.map((p) => ({ date: p.d, value: p.totalDollar }));
    const portR = dailyReturns(portSeriesForRisk).map((x) => x.r);

    const riskVol = annualizedVolatility(portR); // fraction
    const riskMdd = maxDrawdown(portSeriesForRisk); // negative fraction

    let riskBeta: number | null = null;
    let betaSamples = 0;
    
    if (showBenchmark) {
      const benchSeriesForRisk = aligned
        .filter((p) => typeof p.benchDollar === "number" && p.benchDollar !== null)
        .map((p) => ({ date: p.d, value: p.benchDollar as number }));
    
      const portRetSeries = dailyReturns(portSeriesForRisk);
      const benchRetSeries = dailyReturns(benchSeriesForRisk);
    
      const betaRes = betaFromReturnSeries(portRetSeries, benchRetSeries, 20);
      riskBeta = betaRes.beta;
      betaSamples = betaRes.n;
    }

    return {
      kpis: {
        totalValue,
        unrealized,
        dayChange: periodChange,
        sinceStartDollar,
        sinceStartPercent,

        twr: twrValue, // fraction
        xirr: typeof xirrValue === "number" && Number.isFinite(xirrValue) ? xirrValue : null, // fraction
        netContrib,
        hasTx: hasAnyTx,
        hasFlows: hasAnyFlow,

        // Task A
        tfStartValue,
        tfEndValue,
        tfTotalChange,
        tfMarketGrowth,

        riskVol, // fraction
        riskMdd, // negative fraction
        riskBeta, // number
        betaSamples,
      },
      chartData: aligned,
      yAxis: { ticks, domain },
      updates,
      killer,
      periodLabel,
    };
  }, [
    state.positions,
    state.transactions,
    diversificationScore,
    historySeries,
    filteredHistorySeries,
    cutoffISO,
    mode,
    benchSeries,
    showBenchmark,
    timeframe,
  ]);

  const twrColor = typeof kpis.twr === "number" ? (kpis.twr >= 0 ? "text-emerald-600" : "text-red-600") : "text-gray-900";

  const truePerfSub = (
    <div className="space-y-1 leading-tight">
      <div className="text-gray-600">
        Net contrib:{" "}
        <span className="font-semibold text-gray-900">
          {kpis.netContrib >= 0 ? "+" : ""}
          {fmtMoney(kpis.netContrib)}
        </span>
      </div>
      <div className="text-gray-600">
        IRR:{" "}
        <span className="font-semibold text-gray-900">
          {typeof kpis.xirr === "number"
            ? `${fmtSignedPct(kpis.xirr * 100, 2)}/yr`
            : kpis.hasFlows
              ? "needs more history"
              : kpis.hasTx
                ? "add deposits/withdrawals"
                : "add transactions"}
        </span>
      </div>
    </div>
  );

  const riskSub = (
    <span className="text-gray-600">
      {typeof kpis.riskMdd === "number" ? `Max DD: ${fmtNumber(kpis.riskMdd * 100, 1)}%` : "Max DD: needs more history"}
      {showBenchmark ? (
        typeof kpis.riskBeta === "number" ? (
          ` • Beta: ${fmtNumber(kpis.riskBeta, 2)}`
        ) : (
          ` • Beta: ${kpis.betaSamples >= 2 ? "needs more history" : "enable benchmark"}`
        )
      ) : (
        ""
      )}
    </span>
  );
  

  // ---- Task A UI helpers (stacked bar) ----
  const contribAbs = Math.abs(kpis.netContrib ?? 0);
  const growthAbs = Math.abs(kpis.tfMarketGrowth ?? 0);
  const denom = Math.max(contribAbs + growthAbs, 1);
  const contribPct = (contribAbs / denom) * 100;
  const growthPct = (growthAbs / denom) * 100;

  const contribIsPos = (kpis.netContrib ?? 0) >= 0;
  const growthIsPos = (kpis.tfMarketGrowth ?? 0) >= 0;

  const tfLabel = timeframe === "1m" ? "1M" : timeframe === "1y" ? "1Y" : "All";

  return (
    <div className="space-y-4">
      {/* 6-up on desktop so True Performance + Risk Metrics fit cleanly */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
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
          title={kpis.hasTx ? periodLabel : "1-Day Change"}
          value={fmtSignedPct(kpis.dayChange, 2)}
          valueClassName={kpis.dayChange >= 0 ? "text-emerald-600" : "text-red-600"}
        />

        <MetricCard
          title={`True Performance${timeframe === "all" ? "" : timeframe === "1m" ? " (1M)" : " (1Y)"}`}
          value={typeof kpis.twr === "number" ? fmtSignedPct(kpis.twr * 100, 2) : "—"}
          valueClassName={twrColor}
          subValue={truePerfSub}
          subValueClassName="text-gray-600"
        />

        <MetricCard
          title="Risk Metrics"
          value={typeof kpis.riskVol === "number" ? `${fmtNumber(kpis.riskVol * 100, 1)}%` : "—"}
          subValue={riskSub}
          valueClassName="text-gray-900"
          subValueClassName="text-gray-600"
        />
      </div>

      {/* Task A: Contribution vs Market Growth */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-gray-600">Contribution vs Market Growth</div>
              <div className="mt-1 text-xs text-gray-500">Timeframe: {tfLabel}</div>
            </div>
            <div className="text-xs text-gray-500 text-right">
              Start: <span className="font-medium text-gray-700">{fmtMoney(kpis.tfStartValue ?? 0)}</span>
              <br />
              End: <span className="font-medium text-gray-700">{fmtMoney(kpis.tfEndValue ?? 0)}</span>
            </div>
          </div>

          {chartData.length < 2 ? (
            <div className="mt-3 text-sm text-gray-600">Add positions (with purchase dates) to see this breakdown.</div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs font-medium text-gray-500">Net contributions</div>
                  <div className={`mt-1 text-lg font-semibold ${contribIsPos ? "text-emerald-700" : "text-red-700"}`}>
                    {kpis.netContrib >= 0 ? "+" : ""}
                    {fmtMoney(kpis.netContrib ?? 0)}
                  </div>
                </div>

                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs font-medium text-gray-500">Market growth</div>
                  <div className={`mt-1 text-lg font-semibold ${growthIsPos ? "text-emerald-700" : "text-red-700"}`}>
                    {kpis.tfMarketGrowth >= 0 ? "+" : ""}
                    {fmtMoney(kpis.tfMarketGrowth ?? 0)}
                  </div>
                </div>
              </div>

              {/* Stacked bar (uses absolute contribution/growth for proportions) */}
              <div className="mt-4">
                <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100 border">
                  <div className="h-full flex">
                    <div
                      className={contribIsPos ? "bg-emerald-500" : "bg-red-500"}
                      style={{ width: `${contribPct}%` }}
                      title={`Net contributions: ${fmtMoney(kpis.netContrib ?? 0)}`}
                    />
                    <div
                      className={growthIsPos ? "bg-slate-800" : "bg-red-700"}
                      style={{ width: `${growthPct}%` }}
                      title={`Market growth: ${fmtMoney(kpis.tfMarketGrowth ?? 0)}`}
                    />
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${contribIsPos ? "bg-emerald-500" : "bg-red-500"}`} />
                    <span>Contrib ({fmtNumber(contribPct, 0)}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${growthIsPos ? "bg-slate-800" : "bg-red-700"}`} />
                    <span>Growth ({fmtNumber(growthPct, 0)}%)</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Check: (End − Start) ={" "}
                <span className="font-medium text-gray-700">
                  {kpis.tfTotalChange >= 0 ? "+" : ""}
                  {fmtMoney(kpis.tfTotalChange ?? 0)}
                </span>{" "}
                = Contrib + Growth
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
                  domain={yAxis.domain}
                  ticks={yAxis.ticks}
                  tickFormatter={(v: number) => (mode === "dollar" ? fmtMoney(v) : `${fmtNumber(v, 1)}%`)}
                />

                <ReTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;

                    const point = payload[0].payload as {
                      d: string;
                      v: number;
                      b: number | null;
                      breakdown: Record<string, number>;
                      totalDollar: number;
                      benchDollar: number | null;
                      benchPct: number | null;
                    };

                    const entries = Object.entries(point.breakdown || {});
                    entries.sort((a, b) => b[1] - a[1]);

                    return (
                      <div className="rounded-md border bg-white p-3 text-sm shadow-md">
                        <div className="font-medium mb-1">{formatTooltipDate(point.d)}</div>

                        <div className="space-y-1 mb-2">
                          <div className="flex justify-between gap-6">
                            <span className="text-gray-600">Portfolio</span>
                            <span className="font-semibold">{mode === "dollar" ? fmtMoney(point.totalDollar) : `${fmtNumber(point.v, 2)}%`}</span>
                          </div>

                          {showBenchmark && point.b !== null && (
                            <div className="flex justify-between gap-6">
                              <span className="text-gray-600">S&amp;P 500 (SPY)</span>
                              <span className="font-semibold">{mode === "dollar" ? fmtMoney(point.benchDollar ?? 0) : `${fmtNumber(point.benchPct ?? 0, 2)}%`}</span>
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
                  <Line
                    type="monotone"
                    dataKey="b"
                    stroke="#111827"
                    strokeWidth={2}
                    strokeDasharray="6 6"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
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
              ).{" "}
              <span className="text-gray-600">If you want a smoother ride, reduce single-name concentration over time.</span>
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
