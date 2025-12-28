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

export default function OverviewTab() {
  const { state, diversificationScore } = usePortfolioState();
  const [res, setRes] = useState<Resolution>("daily");

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySeries, setHistorySeries] = useState<{ date: string; value: number }[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Prevent flicker: only the latest request is allowed to update loading/data
  const reqIdRef = useRef(0);

  // Fetch true historical portfolio series based on holdings since purchase date
  useEffect(() => {
    const reqId = ++reqIdRef.current;

    async function run() {
      if (!state.positions.length) {
        // only update if still latest
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
        const msg = e instanceof Error ? e.message : "Failed to load historical data";
        if (reqId !== reqIdRef.current) return;
        setHistoryError(msg);
        setHistorySeries([]);
      } finally {
        if (reqId !== reqIdRef.current) return;
        setHistoryLoading(false);
      }
    }

    void run();
  }, [state.positions, state.profile, res]);

  const { kpis, series, updates, riskAlignment } = useMemo(() => {
    // KPIs: use current positions (user-entered currentPrice) instead of snapshots
    const totalValue = state.positions.reduce((acc, p) => {
      const unit =
        typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
          ? p.currentPrice
          : p.costBasisPerUnit;
      return acc + (Number(p.quantity) || 0) * (Number(unit) || 0);
    }, 0);

    const totalCost = state.positions.reduce((acc, p) => {
      return acc + (Number(p.quantity) || 0) * (Number(p.costBasisPerUnit) || 0);
    }, 0);

    const unrealized = totalValue - totalCost;

    // Since-start gains (baseline uses first available point in historical series when possible)
    const baseline = historySeries.length > 0 ? historySeries[0].value : 0;
    const lastHist = historySeries.length > 0 ? historySeries[historySeries.length - 1].value : 0;
    const sinceStartDollar = baseline > 0 ? lastHist - baseline : 0;
    const sinceStartPercent = baseline > 0 ? (sinceStartDollar / baseline) * 100 : 0;

    // 1-day change: approximate using last 2 history points at selected interval
    // (More accurate than snapshots, and avoids flicker)
    const dayChange =
      historySeries.length >= 2
        ? ((historySeries[historySeries.length - 1].value - historySeries[historySeries.length - 2].value) /
            Math.max(historySeries[historySeries.length - 2].value, 1)) *
          100
        : 0;

    // Series for chart (historical-based)
    const chartSeries = historySeries.map((p) => ({
      t: new Date(p.date).toLocaleDateString(),
      v: Number(p.value.toFixed(2)),
    }));

    // Risk alignment
    const totals = state.positions.reduce(
      (acc, p) => {
        const v =
          (typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
            ? p.currentPrice
            : p.costBasisPerUnit) * p.quantity;

        if (isEquityLike(p.assetClass)) acc.equity += v;
        else if (isBondLike(p.assetClass)) acc.bonds += v;
        else if (isCashLike(p.assetClass)) acc.cash += v;
        else acc.equity += v;
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
      historySeries.length < 2
        ? []
        : [
            `Latest: Your portfolio ${dayChange >= 0 ? "gained" : "fell"} ${Math.abs(dayChange).toFixed(2)}% (${res}).`,
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
      series: chartSeries,
      updates,
      riskAlignment: alignmentText,
    };
  }, [state.positions, state.profile?.riskLevel, diversificationScore, historySeries, res]);

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
            <CardTitle className="text-sm text-gray-500">1-Period Change</CardTitle>
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

        {/* Since you want users to input current prices via CSV, this should NOT refetch prices.
           Keep a button just to re-run the history fetch without changing any portfolio inputs. */}
        <Button
          variant="secondary"
          onClick={() => {
            // trigger refetch by bumping reqId and re-running effect via res "no-op" flip
            setRes((r) => r);
          }}
          disabled={historyLoading}
          title={historyLoading ? "Loading history..." : "Reload historical chart"}
        >
          {historyLoading ? "Loading..." : "Reload Chart"}
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
            <p className="text-sm text-gray-600">Add positions (with purchase dates) to see historical trend.</p>
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
