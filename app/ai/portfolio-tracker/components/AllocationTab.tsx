"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { valueForPosition } from "@/lib/portfolioStorage";
import { useMemo } from "react";
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

export default function AllocationTab() {
  const { state, diversificationScore, topConcentrations } = usePortfolioState();

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

    // Sort (largest first) for nicer visuals/legend order
    assetData.sort((a, b) => b.value - a.value);
    accountData.sort((a, b) => b.value - a.value);

    return { assetData, accountData, total };
  }, [state.positions]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Asset Class Allocation</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            {total === 0 ? (
              <p className="text-sm text-gray-600">Add positions to see allocation.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={assetData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={90}
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${fmtPct(Number(percent) || 0)}`}
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
                  <ReTooltip
                    formatter={(value: any) => fmtDollar(Number(value))}
                    labelFormatter={(label: any) => `Account: ${String(label)}`}
                  />
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
          <p className="mt-2 text-sm text-gray-600">
            {diversificationScore >= 70
              ? "Good diversification"
              : diversificationScore >= 40
                ? "Moderate diversification"
                : "Highly concentrated in a few assets"}
          </p>
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
