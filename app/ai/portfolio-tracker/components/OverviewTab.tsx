"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { fetchPortfolioSeries } from "@/lib/portfolioHistory";
import { isBondLike, isCashLike, isEquityLike, targetMixForRisk } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";
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

export default function OverviewTab() {
  const { state, diversificationScore, refreshPrices } = usePortfolioState();
  const [res, setRes] = useState<Resolution>("daily");

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySeries, setHistorySeries] = useState<{ date: string; value: number }[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Fetch true historical portfolio series based on holdings since purchase date
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!state.positions.length) {
        setHistorySeries([]);
        setHistoryError(null);
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

        if (!cancelled) setHistorySeries(series);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load historical data";
        if (!cancelled) setHistoryError(msg);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [state.positions, state.profile, res]);

  const { kpis, series, updates, riskAlignment } = useMemo(() => {
    // Use latest snapshot for "current" KPIs (keeps app responsive + matches existing design)
    const snaps = state.snapshots;
    const last = snaps.at(-1);
    const prev = snaps.at(-2);

    const totalValue = last?.totalValue ?? 0;
    const unrealized = last ? last.totalGainLossDollar : 0;
    const dayChange =
      last && prev ? ((last.totalValue - prev.totalValue) / Math.max(prev.totalValue, 1)) * 100 : 0;

    // Since-start gains (baseline uses first available point in historical series when possible)
    const baseline = historySeries.length > 0 ? historySeries[0].value : 0;
    const lastHist = historySeries.length > 0 ? historySeries[historySeries.length - 1].value : 0;
    const sinceStartDollar = baseline > 0 ? lastHist - baseline : 0;
    const sinceStartPercent = baseline > 0 ? (sinceStartDollar / baseline) * 100 : 0;

    // Series for chart (historical-based)
    const series = historySeries.map((p) => ({
      t: new Date(p.date).toLocaleDateString(),
      v: Number(p.value.toFixed(2)),
    }));

    // Risk alignment
    const totals = state.positions.reduce(
      (acc, p) => {
        const v = (p.currentPrice ?? p.costBasisPerUnit) * p.quantity;
        if (isEquityLike(p.assetClass)) acc.equity += v;
        else if (isBondLike(p.assetClass)) acc.bonds += v;
        else if (isCashLike(p.assetClass)) acc.cash += v;
        else acc.equity += v; // bucket Other as equity-like for simplicity
        acc.total += v;
        return acc;
      },
      { equity: 0, bonds: 0, cash: 0, total: 0 },
    );

    const pct = {
      equity: totals.total ? totals.equity / totals.total : 0,
      bonds: totals.total ? totals.bonds / totals.total : 0,
      cash: totals.total ? totals.cash / totals.total : 0,
    };

    const risk = state.profile?.riskLevel ?? 3;
    const target = targetMixForRisk(risk);
    const deltaEquity = Math.round((pct.equity - target.equity) * 100);

    const alignmentText =
      totals.total === 0
        ? "No positions yet"
        : deltaEquity > 10
          ? "More aggressive than target"
          : deltaEquity < -10
            ? "More conservative than target"
            : "Roughly aligned with target";

    const updates =
      snaps.length < 2
        ? []
        : [
            `Today: Your portfolio ${dayChange >= 0 ? "gained" : "fell"} ${Math.abs(dayChange).toFixed(2)}%.`,
            `Diversification score: ${diversificationScore}/100.`,
          ];

    return {
      kpis: {
        totalValue,
        unrealized,
        dayChange,
        sinceStartDollar,
        sinceStartPercent,
      },
      series,
      updates,
      riskAlignment: alignmentText,
    };
  }, [state.snapshots, state.positions, state.profile?.riskLevel, diversificationScore, historySeries]);

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
            className={`text-2xl font-semibold ${
              kpis.sinceStartDollar >= 0 ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {kpis.sinceStartDollar >= 0 ? "+" : ""}
            ${kpis.sinceStartDollar.toFixed(2)} ({kpis.sinceStartPercent.toFixed(2)}%)
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex items-center justify-between">
            <CardTitle className="text-sm text-gray-500">1-Day Change</CardTitle>
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

      {/* Chart controls */}
      <div className="flex items-center justify-between">
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

        <Button
          variant="secondary"
          onClick={() => refreshPrices()}
          disabled={historyLoading}
          title={historyLoading ? "Loading history..." : "Refresh current prices"}
        >
          {historyLoading ? "Loading..." : "Update Prices"}
        </Button>
      </div>

      {/* Chart */}
      <Card>
        <CardContent className="h-[260px] pt-6">
          {historyError ? (
            <p className="text-sm text-red-600">{historyError}</p>
          ) : historyLoading && series.length === 0 ? (
            <p className="text-sm text-gray-600">Loading historical portfolio chart…</p>
          ) : series.length < 2 ? (
            <p className="text-sm text-gray-600">
              Add positions (with purchase dates) to see historical trend.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="4 4" />
                <XAxis dataKey="t" />
                <YAxis />
                <ReTooltip />
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
            <p className="text-sm text-gray-600">Add positions and refresh prices to see updates.</p>
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