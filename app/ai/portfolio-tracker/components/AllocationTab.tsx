"use client";

import { useMemo, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { valueForPosition } from "@/lib/portfolioStorage";
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

/**
 * ✅ NOTE:
 * - Keep visuals clean, stable, and mobile-friendly.
 * - AllocationTab does NOT hardcode chart colors.
 */

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

    for (const p of state.positions ?? []) {
      const v = valueForPosition(p);
      total += v;

      byAsset.set(p.assetClass, (byAsset.get(p.assetClass) ?? 0) + v);
      byAccount.set(p.accountType, (byAccount.get(p.accountType) ?? 0) + v);

      const a = p.accountType;
      if (!byAccountAsset.has(a)) byAccountAsset.set(a, new Map());
      const inner = byAccountAsset.get(a)!;
      inner.set(p.assetClass, (inner.get(p.assetClass) ?? 0) + v);
    }

    const assetData = Array.from(byAsset.entries())
      .map(([name, value]) => ({
        name,
        value: Number(value.toFixed(2)),
        percent: total ? value / total : 0,
      }))
      .sort((a, b) => b.value - a.value);

    const accountData = Array.from(byAccount.entries())
      .map(([name, value]) => ({
        name,
        value: Number(value.toFixed(2)),
        percent: total ? value / total : 0,
      }))
      .sort((a, b) => b.value - a.value);

    // stable ordering for stacks + legend
    const assetKeys = assetData.map((d) => d.name);

    const stackedAccountRows = accountData.map((acc) => {
      const row: Record<string, any> = { name: acc.name, total: acc.value };
      const inner = byAccountAsset.get(acc.name) ?? new Map();
      for (const k of assetKeys) row[k] = Number((inner.get(k) ?? 0).toFixed(2));
      return row;
    });

    return { assetData, accountData, total, stackedAccountRows, assetKeys };
  }, [state.positions]);

  const tierMeta = scoreLabel(diversificationScore);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Asset Class Allocation */}
        <Card>
          <CardHeader>
            <CardTitle>Asset Class Allocation</CardTitle>
          </CardHeader>

          <CardContent className="h-[380px]">
            {total === 0 ? (
              <p className="text-sm text-gray-600">Add positions to see allocation.</p>
            ) : (
              <div className="w-full h-full flex flex-col">
                <div className="flex-1 min-h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={assetData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={isMobile ? 62 : 72}
                        outerRadius={isMobile ? 96 : 112}
                        paddingAngle={2}
                        stroke="#ffffff"
                        strokeWidth={2}
                        labelLine={false}
                        label={false}
                        isAnimationActive={false}
                      >
                        {/* no explicit fill colors */}
                        {assetData.map((d) => (
                          <Cell key={d.name} />
                        ))}
                      </Pie>

                      {/* Center label */}
                      <text
                        x="50%"
                        y="47%"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="fill-slate-500"
                        style={{ fontSize: 12 }}
                      >
                        Total
                      </text>
                      <text
                        x="50%"
                        y="56%"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="fill-slate-900"
                        style={{ fontSize: 18, fontWeight: 700 }}
                      >
                        {fmtDollar(total)}
                      </text>

                      <ReTooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0] as any;
                          const name = String(p?.name ?? "");
                          const value = Number(p?.value ?? 0);
                          const pct = total > 0 ? value / total : 0;

                          return (
                            <div className="rounded-xl border bg-white p-3 text-sm shadow-lg">
                              <div className="font-semibold text-gray-900 mb-1">{shortAssetName(name)}</div>
                              <div className="flex items-baseline justify-between gap-6">
                                <span className="text-gray-600">Value</span>
                                <span className="font-semibold tabular-nums">{fmtDollar(value)}</span>
                              </div>
                              <div className="flex items-baseline justify-between gap-6">
                                <span className="text-gray-600">Weight</span>
                                <span className="font-semibold tabular-nums">{fmtPct(pct)}</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Custom legend (neutral) */}
                <div className={`mt-4 grid ${isMobile ? "grid-cols-2" : "grid-cols-3"} gap-x-5 gap-y-3`}>
                  {assetData.map((d) => (
                    <div key={d.name} className="flex items-start gap-2">
                      <span className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 bg-gray-300" />
                      <div className="min-w-0 w-full">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-xs font-medium text-gray-800 truncate">{shortAssetName(d.name)}</div>
                          <div className="text-xs font-semibold text-gray-900 tabular-nums">{fmtPct(d.percent)}</div>
                        </div>
                        <div className="text-xs text-gray-500 tabular-nums">{fmtDollar(d.value)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Account Type Allocation */}
        <Card>
          <CardHeader>
            <CardTitle>Account Type Allocation</CardTitle>
          </CardHeader>

          <CardContent className="h-[380px]">
            {total === 0 ? (
              <p className="text-sm text-gray-600">Add positions to see allocation.</p>
            ) : (
              <div className="w-full h-full flex flex-col">
                <div className="text-xs text-gray-600 mb-2">
                  Stacked by asset class (so you can see <span className="font-medium">what</span> each account holds).
                </div>

                <div className="flex-1 min-h-[245px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={stackedAccountRows}
                      margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                      barSize={isMobile ? 28 : 36}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.25} />
                      <XAxis dataKey="name" tickMargin={8} tickLine={false} axisLine={false} />
                      <YAxis
                        tickFormatter={(v: number) => {
                          if (!Number.isFinite(v)) return "";
                          if (v >= 1000) return `$${Math.round(v / 1000)}k`;
                          return fmtDollar(v);
                        }}
                        tickLine={false}
                        axisLine={false}
                      />

                      <ReTooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;

                          const rows = payload
                            .filter((p: any) => p.dataKey !== "total" && typeof p.value === "number" && p.value > 0)
                            .sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0));

                          const accountTotal = payload.find((p: any) => p.dataKey === "total")?.value as
                            | number
                            | undefined;
                          const totalForAcct =
                            typeof accountTotal === "number"
                              ? accountTotal
                              : rows.reduce((s: number, r: any) => s + (r.value ?? 0), 0);

                          return (
                            <div className="rounded-xl border bg-white p-3 text-sm shadow-lg min-w-[230px]">
                              <div className="font-semibold text-gray-900 mb-1">{label}</div>
                              <div className="text-xs text-gray-600 mb-2">Total: {fmtDollar(totalForAcct)}</div>

                              <div className="space-y-1">
                                {rows.map((r: any) => (
                                  <div key={r.dataKey} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                                      <span className="text-gray-700 truncate">{shortAssetName(String(r.dataKey))}</span>
                                    </div>
                                    <span className="font-medium text-gray-900 tabular-nums">
                                      {fmtDollar(Number(r.value))}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }}
                      />

                      {/* invisible total for tooltip */}
                      <Bar dataKey="total" fill="transparent" stackId="__total" />

                      {/* no explicit fill colors */}
                      {assetKeys.map((k) => (
                        <Bar key={k} dataKey={k} stackId="acct" isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend (neutral) */}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-700">
                  {assetKeys.map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                      <span className="font-medium">{shortAssetName(k)}</span>
                    </div>
                  ))}
                </div>

                {/* ✅ Replaces the old “bubbles” with a clean mini-table */}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-gray-500 border-b">
                      <tr>
                        <th className="py-2 text-left">Account</th>
                        <th className="py-2 text-right">Weight</th>
                        <th className="py-2 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountData.map((a) => (
                        <tr key={a.name} className="border-b last:border-0">
                          <td className="py-2 font-medium text-gray-900">{a.name}</td>
                          <td className="py-2 text-right tabular-nums">{fmtPct(a.percent)}</td>
                          <td className="py-2 text-right tabular-nums">{fmtDollar(a.value)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="py-2 font-semibold">Total</td>
                        <td className="py-2" />
                        <td className="py-2 text-right font-semibold tabular-nums">{fmtDollar(total)}</td>
                      </tr>
                    </tbody>
                  </table>
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
              <div className="rounded-xl border bg-white p-3">
                <div className="text-xs text-gray-600">Top holding</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {diversificationDetails.topHoldingTicker ?? "—"} ·{" "}
                  {Math.round((diversificationDetails.topHoldingPct ?? 0) * 100)}%
                </div>
              </div>

              <div className="rounded-xl border bg-white p-3">
                <div className="text-xs text-gray-600">Top 3 holdings</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {Math.round((diversificationDetails.top3Pct ?? 0) * 100)}%
                </div>
              </div>

              <div className="rounded-xl border bg-white p-3">
                <div className="text-xs text-gray-600">Equity</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {Math.round((diversificationDetails.buckets?.equity ?? 0) * 100)}%
                </div>
              </div>

              <div className="rounded-xl border bg-white p-3">
                <div className="text-xs text-gray-600">Cash/MM</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {Math.round((diversificationDetails.buckets?.cash ?? 0) * 100)}%
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

      {/* Allocation Table */}
      <Card>
        <CardHeader>
          <CardTitle>Allocation Table</CardTitle>
        </CardHeader>
        <CardContent>
          {total === 0 ? (
            <p className="text-sm text-gray-600">Add positions to see allocation.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-500 border-b">
                  <tr>
                    <th className="py-2 text-left">Bucket</th>
                    <th className="py-2 text-right">Weight</th>
                    <th className="py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {assetData.map((d) => (
                    <tr key={d.name} className="border-b last:border-0">
                      <td className="py-2 font-medium text-gray-900">{shortAssetName(d.name)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtPct(d.percent)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtDollar(d.value)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 font-semibold">Total</td>
                    <td className="py-2" />
                    <td className="py-2 text-right font-semibold tabular-nums">{fmtDollar(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
