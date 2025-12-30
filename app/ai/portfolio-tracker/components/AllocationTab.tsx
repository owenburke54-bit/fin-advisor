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
  Legend,
} from "recharts";

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#a3a3a3"];

const moneyFmt0 = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const moneyFmt2 = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function fmtDollar(n: number, decimals: 0 | 2 = 0) {
  const v = Number(n) || 0;
  return decimals === 2 ? moneyFmt2.format(v) : moneyFmt0.format(v);
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

  const { assetData, accountData, total, stackedAccountRows, assetKeys } = useMemo(() => {
    const byAsset = new Map<string, number>();
    const byAccount = new Map<string, number>();
    const byAccountAsset = new Map<string, Map<string, number>>();
    let total = 0;

    for (const p of state.positions) {
      const v = valueForPosition(p);
      total += v;

      // Asset totals
      byAsset.set(p.assetClass, (byAsset.get(p.assetClass) ?? 0) + v);

      // Account totals
      byAccount.set(p.accountType, (byAccount.get(p.accountType) ?? 0) + v);

      // Account x Asset for stacked bars
      const a = p.accountType;
      if (!byAccountAsset.has(a)) byAccountAsset.set(a, new Map());
      const inner = byAccountAsset.get(a)!;
      inner.set(p.assetClass, (inner.get(p.assetClass) ?? 0) + v);
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

    // keys = unique asset classes present, ordered by overall size (nice legend + stack order)
    const assetKeys = assetData.map((d) => d.name);

    // build stacked rows: { name: "Taxable", total: 123, "ETF": 50, "Equity": 70, ... }
    const stackedAccountRows = accountData.map((acc) => {
      const row: Record<string, any> = { name: acc.name, total: acc.value };
      const inner = byAccountAsset.get(acc.name) ?? new Map();
      for (const k of assetKeys) row[k] = Number((inner.get(k) ?? 0).toFixed(2));
      return row;
    });

    return { assetData, accountData, total, stackedAccountRows, assetKeys };
  }, [state.positions]);

  const tierMeta = scoreLabel(diversificationScore);

  const colorForAsset = (assetName: string) => {
    const idx = assetKeys.findIndex((k) => k === assetName);
    return COLORS[(idx >= 0 ? idx : 0) % COLORS.length];
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Asset Class Allocation */}
        <Card>
          <CardHeader>
            <CardTitle>Asset Class Allocation</CardTitle>
          </CardHeader>

          {/* Slightly taller + more deliberate layout */}
          <CardContent className="h-[360px]">
            {total === 0 ? (
              <p className="text-sm text-gray-600">Add positions to see allocation.</p>
            ) : (
              <div className="w-full h-full flex flex-col">
                {/* Donut area */}
                <div className="flex-1 min-h-[210px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={assetData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={isMobile ? 52 : 58}
                        outerRadius={isMobile ? 86 : 96}
                        paddingAngle={2}
                        labelLine={false}
                        label={false}
                        isAnimationActive={false}
                      >
                        {assetData.map((d) => (
                          <Cell key={d.name} fill={colorForAsset(d.name)} />
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

                {/* Legend below (2 columns on mobile, 3 on desktop) */}
                <div className={`mt-3 grid ${isMobile ? "grid-cols-2" : "grid-cols-3"} gap-x-4 gap-y-2`}>
                  {assetData.map((d) => (
                    <div key={d.name} className="flex items-start gap-2">
                      <span
                        className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: colorForAsset(d.name) }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-gray-700 truncate">{shortAssetName(d.name)}</div>
                        <div className="text-xs text-gray-600">
                          <span className="font-semibold text-gray-900">{fmtPct(d.percent)}</span>{" "}
                          <span className="text-gray-500">({fmtDollar(d.value)})</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Account Type Allocation (more complex + visually appealing) */}
        <Card>
          <CardHeader>
            <CardTitle>Account Type Allocation</CardTitle>
          </CardHeader>

          <CardContent className="h-[360px]">
            {total === 0 ? (
              <p className="text-sm text-gray-600">Add positions to see allocation.</p>
            ) : (
              <div className="w-full h-full flex flex-col">
                <div className="text-xs text-gray-600 mb-2">
                  Stacked by asset class (so you can see *what* each account holds).
                </div>

                <div className="flex-1 min-h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stackedAccountRows} margin={{ left: 8, right: 12, top: 4, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="4 4" />
                      <XAxis dataKey="name" tickMargin={8} />
                      <YAxis tickFormatter={(v: number) => fmtDollar(v)} />
                      <ReTooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;

                          const rows = payload
                            .filter((p: any) => p.dataKey !== "total" && typeof p.value === "number" && p.value > 0)
                            .sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0));

                          const accountTotal = payload.find((p: any) => p.dataKey === "total")?.value as number | undefined;
                          const totalForAcct = typeof accountTotal === "number" ? accountTotal : rows.reduce((s: number, r: any) => s + (r.value ?? 0), 0);

                          return (
                            <div className="rounded-md border bg-white p-3 text-sm shadow-md min-w-[220px]">
                              <div className="font-semibold text-gray-900 mb-1">{label}</div>
                              <div className="text-xs text-gray-600 mb-2">Total: {fmtDollar(totalForAcct)}</div>
                              <div className="space-y-1">
                                {rows.map((r: any) => (
                                  <div key={r.dataKey} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                                      <span className="text-gray-700 truncate">{shortAssetName(String(r.dataKey))}</span>
                                    </div>
                                    <span className="font-medium text-gray-900">{fmtDollar(Number(r.value))}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }}
                      />

                      {/* Invisible total for tooltip */}
                      <Bar dataKey="total" fill="transparent" stackId="__total" />

                      {assetKeys.map((k) => (
                        <Bar
                          key={k}
                          dataKey={k}
                          stackId="acct"
                          fill={colorForAsset(k)}
                          radius={[6, 6, 0, 0]}
                          isAnimationActive={false}
                        />
                      ))}

                      <Legend
                        wrapperStyle={{ fontSize: 12 }}
                        formatter={(v: any) => shortAssetName(String(v))}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Quick summary chips */}
                <div className={`mt-3 grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-2`}>
                  {stackedAccountRows.map((r) => (
                    <div key={r.name} className="rounded-lg border bg-white px-3 py-2 flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-800">{r.name}</div>
                      <div className="text-sm text-gray-900 font-semibold">
                        {fmtDollar(r.total)}{" "}
                        <span className="text-gray-500 font-normal">({fmtPct(r.total / Math.max(total, 1))})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Diversification Score */}
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

      {/* Top Concentrations */}
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
