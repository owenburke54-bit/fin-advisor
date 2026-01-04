"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { fetchPortfolioSeries } from "@/lib/portfolioHistory";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { valueForPosition } from "@/lib/portfolioStorage";
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
  Legend,
} from "recharts";

type ChartMode = "dollar" | "percent";
type Timeframe = "all" | "1m" | "1y";

type HistoryPoint = { date: string; close: number };

type HistoryResponse = {
  tickers: string[];
  interval: "1d" | "1wk" | "1mo";
  start?: string;
  end?: string;
  data: Record<string, { points: HistoryPoint[]; error?: string }>;
};

function fmtSignedPct(n: number, decimals = 2) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${fmtNumber(n, decimals)}%`;
}

function formatAxisDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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
}): Promise<{ points: HistoryPoint[]; error?: string }> {
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
    if (!res.ok) return { points: [], error: `HTTP ${res.status}` };

    const json = (await res.json()) as HistoryResponse;

    const key = (json?.tickers?.[0] ?? ticker).toUpperCase();
    const payload = json?.data?.[key] ?? json?.data?.[ticker] ?? null;

    const points = (payload?.points ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    return { points, error: payload?.error };
  } catch (e) {
    return { points: [], error: e instanceof Error ? e.message : "Fetch failed" };
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
  footnote?: React.ReactNode;
  tone?: "default" | "pos" | "neg";
}) {
  const { title, value, footnote, tone = "default" } = props;

  const toneClass = tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-red-600" : "text-gray-900";

  return (
    <Card className="h-full">
      <CardContent className="p-6 flex flex-col h-full">
        <div className="text-sm font-medium text-gray-600">{title}</div>

        <div className="mt-4 min-h-[48px] flex items-end">
          <div className={`text-4xl font-semibold tracking-tight leading-none tabular-nums ${toneClass}`}>{value}</div>
        </div>

        <div className="flex-1" />

        <div className="mt-5 pt-4 border-t min-h-[34px] flex items-center justify-between gap-3 text-sm text-gray-600">
          {footnote ?? <span className="text-gray-400"> </span>}
        </div>
      </CardContent>
    </Card>
  );
}

function niceTicks(
  min: number,
  max: number,
  count: number,
  mode: ChartMode,
): { ticks: number[]; domain: [number, number] } {
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

function isCashLike(assetClass?: string) {
  return assetClass === "Money Market" || assetClass === "Cash";
}

/** Compact y-axis labels so we don’t waste left space (e.g. $23.4k) */
function fmtCompactMoney(v: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);

  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${fmtNumber(abs / 1_000_000_000, 1)}B`;
  if (abs >= 1_000_000) return `${sign}$${fmtNumber(abs / 1_000_000, 1)}M`;
  if (abs >= 1_000) return `${sign}$${fmtNumber(abs / 1_000, 1)}k`;
  return `${sign}$${fmtNumber(abs, 0)}`;
}

export default function OverviewTab() {
  const { state, diversificationScore } = usePortfolioState();

  const [mode, setMode] = useState<ChartMode>("dollar");
  const [timeframe, setTimeframe] = useState<Timeframe>("all");
  const [showBenchmark, setShowBenchmark] = useState(true);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySeries, setHistorySeries] = useState<{ date: string; value: number; breakdown?: Record<string, number> }[]>(
    [],
  );
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [benchLoading, setBenchLoading] = useState(false);
  const [benchSeries, setBenchSeries] = useState<{ date: string; close: number }[]>([]);
  const [benchError, setBenchError] = useState<string | null>(null);

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
      setBenchError(null);

      if (!showBenchmark || filteredHistorySeries.length < 2) {
        if (benchReqId !== benchReqIdRef.current) return;
        setBenchSeries([]);
        setBenchLoading(false);
        return;
      }

      const start = filteredHistorySeries[0].date;
      const end = filteredHistorySeries[filteredHistorySeries.length - 1].date;

      setBenchLoading(true);

      const { points, error } = await fetchHistoryTicker({ ticker: "SPY", start, end, interval: "1d" });

      if (benchReqId !== benchReqIdRef.current) return;

      setBenchSeries(points);
      setBenchError(error ?? null);
      setBenchLoading(false);
    }

    void runBench();
  }, [filteredHistorySeries, showBenchmark]);

  const { kpis, chartData, yAxis, updates, driver } = useMemo(() => {
    const totalValue = (state.positions ?? []).reduce((acc, p) => acc + valueForPosition(p as any), 0);

    const cashValue = (state.positions ?? [])
      .filter((p) => isCashLike(p.assetClass))
      .reduce((acc, p) => acc + valueForPosition(p as any), 0);

    const investedValue = totalValue - cashValue;

    const investedCost = (state.positions ?? [])
      .filter((p) => !isCashLike(p.assetClass))
      .reduce((acc, p) => acc + (Number(p.quantity) || 0) * (Number(p.costBasisPerUnit) || 0), 0);

    const unrealized = investedValue - investedCost;

    const fullBaseline = historySeries.length ? historySeries[0].value : 0;
    const fullLast = historySeries.length ? historySeries.at(-1)!.value : 0;
    const sinceStartDollar = fullBaseline > 0 ? fullLast - fullBaseline : 0;
    const sinceStartPercent = fullBaseline > 0 ? (sinceStartDollar / fullBaseline) * 100 : 0;

    const periodChange =
      historySeries.length >= 2
        ? ((historySeries.at(-1)!.value - historySeries.at(-2)!.value) / Math.max(historySeries.at(-2)!.value, 1)) * 100
        : 0;

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

    const flowsAll = cashFlowsFromTransactions(state.transactions ?? []);
    const perfSeries = filteredHistorySeries.map((p) => ({ date: p.date, value: p.value }));

    const terminalValue = perfSeries.length ? perfSeries.at(-1)!.value : totalValue;
    const terminalDate = perfSeries.length ? perfSeries.at(-1)!.date : todayISO();

    const flowsTf = flowsAll
      .filter((f) => typeof f?.date === "string" && typeof f?.amount === "number")
      .filter((f) => (!cutoffISO ? true : f.date >= cutoffISO))
      .filter((f) => f.date <= terminalDate);

    const twrValue = perfSeries.length >= 2 ? twr(perfSeries, flowsTf) : null;
    const irrFlows = xirrCashFlowsWithTerminalValue(flowsTf, terminalDate, terminalValue);
    const xirrValue = xirr(irrFlows);

    const netContrib = sumNetContributions(state.transactions ?? [], cutoffISO, terminalDate);

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

    const driver = (() => {
      const nonCash = (state.positions ?? []).filter((p) => !isCashLike(p.assetClass));
      if (!nonCash.length) return null;

      const rows = nonCash
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

    const portSeriesForRisk = aligned.map((p) => ({ date: p.d, value: p.totalDollar }));
    const portR = dailyReturns(portSeriesForRisk).map((x) => x.r);

    const riskVol = annualizedVolatility(portR);
    const riskMdd = maxDrawdown(portSeriesForRisk);

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
        cashValue,
        investedValue,
        investedCost,
        unrealized,

        dayChange: periodChange,
        sinceStartDollar,
        sinceStartPercent,

        twr: twrValue,
        xirr: typeof xirrValue === "number" && Number.isFinite(xirrValue) ? xirrValue : null,
        netContrib,

        tfStartValue,
        tfEndValue,
        tfTotalChange,
        tfMarketGrowth,

        riskVol,
        riskMdd,
        riskBeta,
        betaSamples,
      },
      chartData: aligned,
      yAxis: { ticks, domain },
      updates,
      driver,
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

  const tfLabel = timeframe === "1m" ? "1M" : timeframe === "1y" ? "1Y" : "All";

  const contribAbs = Math.abs(kpis.netContrib ?? 0);
  const growthAbs = Math.abs(kpis.tfMarketGrowth ?? 0);
  const denom = Math.max(contribAbs + growthAbs, 1);
  const contribPct = (contribAbs / denom) * 100;
  const growthPct = (growthAbs / denom) * 100;

  const contribIsPos = (kpis.netContrib ?? 0) >= 0;
  const growthIsPos = (kpis.tfMarketGrowth ?? 0) >= 0;

  const unrealTone = kpis.unrealized >= 0 ? "pos" : "neg";
  const sinceTone = kpis.sinceStartDollar >= 0 ? "pos" : "neg";
  const twrTone = typeof kpis.twr === "number" ? (kpis.twr >= 0 ? "pos" : "neg") : "default";
  const contribTone = (kpis.netContrib ?? 0) >= 0 ? "pos" : "neg";

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Total Value"
          value={fmtMoney(kpis.totalValue)}
          footnote={
            <>
              <span className="text-gray-500">Cash/MM</span>
              <span className="font-medium text-gray-700 tabular-nums">{fmtMoney(kpis.cashValue ?? 0)}</span>
            </>
          }
        />

        <MetricCard
          title="Unrealized P/L"
          value={
            <>
              {kpis.unrealized >= 0 ? "+" : ""}
              {fmtMoney(kpis.unrealized)}
            </>
          }
          tone={unrealTone}
          footnote={
            <>
              <span className="text-gray-500">Invested cost</span>
              <span className="font-medium text-gray-700 tabular-nums">{fmtMoney(kpis.investedCost ?? 0)}</span>
            </>
          }
        />

        <MetricCard
          title="Since Start"
          value={
            <>
              {kpis.sinceStartDollar >= 0 ? "+" : ""}
              {fmtMoney(kpis.sinceStartDollar)}
            </>
          }
          tone={sinceTone}
          footnote={
            <>
              <span className="text-gray-500">Return</span>
              <span className={`font-medium tabular-nums ${kpis.sinceStartPercent >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {fmtSignedPct(kpis.sinceStartPercent, 2)}
              </span>
            </>
          }
        />

        <MetricCard
          title={`True Return (${tfLabel})`}
          value={typeof kpis.twr === "number" ? fmtSignedPct(kpis.twr * 100, 2) : "—"}
          tone={twrTone}
          footnote={<span className="text-gray-500">TWR (cash-flow adjusted)</span>}
        />

        <MetricCard
          title={`Net Contrib (${tfLabel})`}
          value={
            <>
              {(kpis.netContrib ?? 0) >= 0 ? "+" : ""}
              {fmtMoney(kpis.netContrib ?? 0)}
            </>
          }
          tone={contribTone}
          footnote={<span className="text-gray-500">Deposits − withdrawals</span>}
        />

        <MetricCard
          title="Risk"
          value={typeof kpis.riskVol === "number" ? `${fmtNumber(kpis.riskVol * 100, 1)}%` : "—"}
          tone="default"
          footnote={
            <>
              <span className="text-gray-500 tabular-nums">DD {typeof kpis.riskMdd === "number" ? `${fmtNumber(kpis.riskMdd * 100, 1)}%` : "—"}</span>
              <span className="font-medium text-gray-700 tabular-nums">
                β {showBenchmark && typeof kpis.riskBeta === "number" ? fmtNumber(kpis.riskBeta, 2) : "—"}
              </span>
            </>
          }
        />
      </div>

      {/* Contribution vs Market Growth */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-gray-600">Contribution vs Market Growth</div>
              <div className="mt-1 text-xs text-gray-500">Timeframe: {tfLabel}</div>
            </div>

            <div className="text-xs text-gray-500 text-right">
              As of <span className="font-medium text-gray-700">{new Date().toLocaleDateString()}</span>
            </div>
          </div>

          {chartData.length < 2 ? (
            <div className="mt-3 text-sm text-gray-600">Add positions (with purchase dates) to see this breakdown.</div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border bg-white p-4">
                  <div className="text-xs font-medium text-gray-500">Net contributions</div>
                  <div className={`mt-1 text-xl font-semibold tabular-nums ${contribIsPos ? "text-emerald-700" : "text-red-700"}`}>
                    {kpis.netContrib >= 0 ? "+" : ""}
                    {fmtMoney(kpis.netContrib ?? 0)}
                  </div>
                </div>

                <div className="rounded-xl border bg-white p-4">
                  <div className="text-xs font-medium text-gray-500">Market growth</div>
                  <div className={`mt-1 text-xl font-semibold tabular-nums ${growthIsPos ? "text-emerald-700" : "text-red-700"}`}>
                    {kpis.tfMarketGrowth >= 0 ? "+" : ""}
                    {fmtMoney(kpis.tfMarketGrowth ?? 0)}
                  </div>
                </div>
              </div>

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
                    <span className="tabular-nums">Contrib ({fmtNumber(contribPct, 0)}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${growthIsPos ? "bg-slate-800" : "bg-red-700"}`} />
                    <span className="tabular-nums">Growth ({fmtNumber(growthPct, 0)}%)</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Check: (End − Start) ={" "}
                <span className="font-medium text-gray-700 tabular-nums">
                  {kpis.tfTotalChange >= 0 ? "+" : ""}
                  {fmtMoney(kpis.tfTotalChange ?? 0)}
                </span>{" "}
                = Contrib + Growth
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Controls */}
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

      {/* Trend chart */}
      <Card>
        <CardContent className="h-[300px] p-4">
          {historyError ? (
            <p className="text-sm text-red-600">{historyError}</p>
          ) : historyLoading && chartData.length === 0 ? (
            <p className="text-sm text-gray-600">Loading historical portfolio chart…</p>
          ) : chartData.length < 2 ? (
            <p className="text-sm text-gray-600">Add positions (with purchase dates) to see historical trend.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 14, left: 6, bottom: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.25} />
                  <XAxis
                    dataKey="d"
                    tickMargin={8}
                    minTickGap={28}
                    tickFormatter={formatAxisDate}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    width={64}
                    domain={yAxis.domain}
                    ticks={yAxis.ticks}
                    tickFormatter={(v: number) => (mode === "dollar" ? fmtCompactMoney(v) : `${fmtNumber(v, 1)}%`)}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={6}
                  />

                  {/* Legend INSIDE the chart so it’s fully visible and “on-chart” */}
                  <Legend
                    verticalAlign="top"
                    align="left"
                    iconType="plainline"
                    wrapperStyle={{
                      paddingLeft: 6,
                      paddingTop: 2,
                      fontSize: 12,
                    }}
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
                        <div className="rounded-xl border bg-white p-3 text-sm shadow-lg">
                          <div className="font-medium mb-2">{formatTooltipDate(point.d)}</div>

                          <div className="space-y-1 mb-2">
                            <div className="flex justify-between gap-6">
                              <span className="text-gray-600">Portfolio</span>
                              <span className="font-semibold tabular-nums">
                                {mode === "dollar" ? fmtMoney(point.totalDollar) : `${fmtNumber(point.v, 2)}%`}
                              </span>
                            </div>

                            {showBenchmark && point.b !== null && (
                              <div className="flex justify-between gap-6">
                                <span className="text-gray-600">S&amp;P 500 (SPY)</span>
                                <span className="font-semibold tabular-nums">
                                  {mode === "dollar" ? fmtMoney(point.benchDollar ?? 0) : `${fmtNumber(point.benchPct ?? 0, 2)}%`}
                                </span>
                              </div>
                            )}
                          </div>

                          {mode === "dollar" && entries.length > 0 && (
                            <div className="pt-2 border-t space-y-1">
                              {entries.map(([k, v]) => (
                                <div key={k} className="flex justify-between gap-6">
                                  <span className="text-gray-600">{k}</span>
                                  <span className="font-mono tabular-nums">{fmtMoney(v, 0)}</span>
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

                  {/* Portfolio = solid blue, Benchmark = dashed dark */}
                  <Line
                    type="monotone"
                    dataKey="v"
                    name="Portfolio"
                    stroke="#2563eb"
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                  />

                  {showBenchmark && (
                    <Line
                      type="monotone"
                      dataKey="b"
                      name="S&P 500 (SPY)"
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
            </>
          )}

          {showBenchmark && benchLoading && <p className="mt-2 text-xs text-gray-500">Loading benchmark (SPY)…</p>}
          {showBenchmark && !benchLoading && benchError && <p className="mt-2 text-xs text-red-600">Benchmark error: {benchError}</p>}
        </CardContent>
      </Card>

      {/* Primary Driver */}
      <Card>
        <CardContent className="p-5">
          <div className="text-sm font-medium text-gray-600">Primary Driver</div>

          {driver ? (
            <div className="mt-2 text-sm text-gray-900">
              <span className="font-semibold">{driver.ticker}</span> is contributing the largest share of your {driver.dir} right now{" "}
              <span className={driver.pnl >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                ({driver.pnl >= 0 ? "+" : ""}
                {fmtMoney(driver.pnl)})
              </span>
              . <span className="text-gray-600">If you want to reduce volatility, lower single-name concentration over time.</span>
            </div>
          ) : (
            <div className="mt-2 text-sm text-gray-600">Add positions to see your primary return driver.</div>
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
