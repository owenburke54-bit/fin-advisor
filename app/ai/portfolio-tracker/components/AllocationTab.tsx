"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { valueForPosition } from "@/lib/portfolioStorage";
import { useMemo, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as ReTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#a3a3a3"];

function fmtDollar(n: number) {
  const v = Number(n) || 0;
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtPct(p: number) {
  return `${(p * 100).toFixed(1)}%`;
}

function shortAssetName(name: string) {
  const map: Record<string, string> = {
    "Money Market": "Money Market",
    "Mutual Fund": "Mutual Fund",
    "International Equity": "International",
    "US Equity": "US Equity",
    "Fixed Income": "Bonds",
  };
  return map[name] ?? name;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [query]);

  return matches;
}

function scoreLabel(score: number) {
  if (score >= 85) return { tier: "Excellent", hint: "Very well diversified across holdings and buckets." };
  if (score >= 70) return { tier: "Good", hint: "Solid diversification with a few areas to improve." };
  if (score >= 40) return { tier: "Fair", hint: "Moderately concentrated—rebalancing would help." };
  return { tier: "Poor", hint: "Highly concentrated—consider spreading risk." };
}

export default function AllocationTab() {
  const { state, diversificationScore, diversificationDetails, topConcentrations } = usePortfolioState();
  const isMobile = useMediaQuery("(max-width: 640px)");

  const { assetData, accountData, total } = useMemo(() => {
    const byAsset = new Map<string, number>();
    const byAccount = new Map<string, number>();
    let total = 0;

    for (const p of state.positions) {
      const v = valueForPosition(p);
      total += v;
      byAsset.set(p.assetClass, (byAsset.get(p.assetClass) ?? 0) + v);
      byAccount.set(p.accountType, (byAccount.get(p.accountType) ?? 0) + v);
    }

    const assetData = Array.from(byAsset.entries()).map(([name, value]) => ({
      name,
      value: Number(value.toFixed(2)),
      percent: total ? value / total : 0,
    }));

    const accountData = Array.from(byAccount.entries()).map(([name, value]) => ({
      name,
      value: Number(value.toFixed(2)),
      percent: total ? value / total : 0,
    }));

    assetData.sort((a, b) => b.value - a.value);
    accountData.sort((a, b) => b.value - a.value);

    return { assetData, accountData, total };
  }, [state.positions]);

  const tierMeta = scoreLabel(diversificationScore);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Asset Class Allocation</CardTitle>
          </CardHeader>

          <CardContent className="h-[320px]">
            {total === 0 ? (
              <p className="text-sm text-gray-600">Add positions to see allocation.</p>
            ) : (
              <div className="w-full h-full flex flex-col">
                <div className="flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={assetData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                        labelLine={false}
                        label={false}
                        isAnimationActive={false}
                      >
                        {assetData.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Pie>

                      <ReTooltip
                        formatter={(value: any, _name: any, props: any) => {
                          const payload = props?.payload as { percent?: number; name?: string };
                          const pct = typeof payload?.percent === "number" ? ` (${fmtPct(payload.percent)})` : "";
                          return [`${fmtDollar(Number(value))}${pct}`, payload?.name ?? "Value"];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Clean legend (better than cluttered labels) */}
                <div className={`mt-3 grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-2`}>
                  {assetData.map((d, idx) => (
                    <div key={d.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                        />
                        <span className="text-gray-700 truncate">{shortAssetName(d.name)}</span>
                      </div>
                      <span className="font-medium text-gray-900">
                        {fmtPct(d.percent)} <span className="text-gray-500 font-normal">({fmtDollar(d.value)})</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account Type Allocation</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            {total === 0 ? (
              <p className="text-sm text-gray-600">Add positions to see allocation.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={accountData} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="4 4" />
                  <XAxis dataKey="name" tickMargin={8} />
                  <YAxis tickFormatter={(v: number) => fmtDollar(v)} />
                  <ReTooltip formatter={(value: any) => fmtDollar(Number(value))} labelFormatter={(label: any) => `Account: ${String(label)}`} />
                  <Bar dataKey="value" fill="#2563eb" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Diversification Score</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Progress value={diversificationScore} />
            <span className="text-sm font-medium w-16 text-right">{diversificationScore}</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border bg-white px-2 py-0.5 text-xs font-semibold">{tierMeta.tier}</span>
            <span className="text-sm text-gray-600">{tierMeta.hint}</span>
          </div>

          {state.positions.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-white p-3">
                <div className="text-xs text-gray-600">Top holding</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {diversificationDetails.topHoldingTicker ?? "—"} · {Math.round(diversificationDetails.topHoldingPct * 100)}%
                </div>
              </div>

              <div className="rounded-lg border bg-white p-3">
                <div className="text-xs text-gray-600">Top 3 holdings</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {Math.round(diversificationDetails.top3Pct * 100)}%
                </div>
              </div>

              <div className="rounded-lg border bg-white p-3">
                <div className="text-xs text-gray-600">Equity</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {Math.round(diversificationDetails.buckets.equity * 100)}%
                </div>
              </div>

              <div className="rounded-lg border bg-white p-3">
                <div className="text-xs text-gray-600">Cash/MM</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {Math.round(diversificationDetails.buckets.cash * 100)}%
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Concentrations</CardTitle>
        </CardHeader>
        <CardContent>
          {topConcentrations.length === 0 ? (
            <p className="text-sm text-gray-600">No positions yet.</p>
          ) : (
            <ul className="space-y-1">
              {topConcentrations.map((c) => (
                <li key={c.ticker} className="text-sm">
                  <span className="font-medium">{c.ticker}</span> — {(c.percent * 100).toFixed(1)}% ({fmtDollar(c.value)})
                  {c.percent > 0.2 && <span className="ml-2 text-red-600">Warning: over 20% concentration</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
