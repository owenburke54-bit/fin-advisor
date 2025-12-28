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

export default function OverviewTab() {
  const { state, diversificationScore } = usePortfolioState();
  const [res, setRes] = useState<Resolution>("daily");
  const [mode, setMode] = useState<ChartMode>("dollar");

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySeries, setHistorySeries] = useState<
    {
      date: string;
      value: number;
      breakdown?: Record<string, number>;
    }[]
  >([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [reloadNonce, setReloadNonce] = useState(0);
  const reqIdRef = useRef(0);

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

  const { kpis, series, yDomain, updates, riskAlignment, periodLabel } = useMemo(() => {
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

    // ✅ include breakdown for tooltip
    const chartSeries = historySeries.map((p) => {
      const dollar = Number(p.value.toFixed(2));
      const percent = baseForPct > 0 ? Number((((p.value / baseForPct) - 1) * 100).toFixed(4)) : 0;

      return {
        d: p.date,
        v: mode === "dollar" ? dollar : percent,
        breakdown: p.breakdown ?? {},
        totalDollar: dollar, // convenient for tooltip
      };
    });

    // Tight Y-axis domain (zoom in)
    const vals = chartSeries.map((d) => d.v);
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

    // Risk alignment
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
      series: chartSeries,
      yDomain,
      updates,
      riskAlignment: alignmentText,
      periodLabel,
    };
  }, [state.positions, state.profile?.riskLevel, diversificationScore, historySeries, res, mode]);

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

        <div className="flex gap-2">
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
          ) : series.length < 2 ? (
            <p className="text-sm text-gray-600">Add positions (with purchase dates) to see historical trend.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="4 4" />
                <XAxis dataKey="d" tickMargin={8} minTickGap={28} tickFormatter={formatAxisDate} />
                <YAxis
                  domain={yDomain}
                  tickFormatter={(v: number) => (mode === "dollar" ? fmtDollar(v) : `${v.toFixed(1)}%`)}
                />

                {/* ✅ CUSTOM TOOLTIP WITH BREAKDOWN */}
                <ReTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;

                    const point = payload[0].payload as {
                      d: string;
                      v: number;
                      breakdown: Record<string, number>;
                      totalDollar: number;
                    };

                    // Sort breakdown biggest -> smallest, keep Cash at bottom if present
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

                        <div className="font-semibold mb-2">
                          Total: {mode === "dollar" ? fmtDollar(point.totalDollar) : fmtPct(point.v)}
                        </div>

                        {mode === "dollar" && entries.length > 0 && (
                          <div className="space-y-1">
                            {entries.map(([k, v]) => (
                              <div key={k} className="flex justify-between gap-6">
                                <span className="text-gray-600">{k}</span>
                                <span className="font-mono">${v.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {mode === "percent" && (
                          <div className="text-xs text-gray-500">
                            Tip: switch to <span className="font-medium">$</span> to see ticker breakdown.
                          </div>
                        )}
                      </div>
                    );
                  }}
                />

                <Line type="monotone" dataKey="v" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
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
