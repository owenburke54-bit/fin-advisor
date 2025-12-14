"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Slider } from "@/components/ui/Slider";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as ReTooltip, CartesianGrid } from "recharts";

function futureValueLumpSum(present: number, annualRate: number, years: number): number {
  const r = annualRate;
  return present * Math.pow(1 + r, years);
}

function futureValueAnnuity(monthlyContribution: number, annualRate: number, years: number): number {
  const r = annualRate;
  const n = years * 12;
  const mr = r / 12;
  if (mr === 0) return monthlyContribution * n;
  return monthlyContribution * ((Math.pow(1 + mr, n) - 1) / mr);
}

export default function GoalsTab() {
  const { state } = usePortfolioState();
  const profile = state.profile;
  const current = state.snapshots.at(-1)?.totalValue ?? 0;

  const [monthly, setMonthly] = useState<number>(profile?.monthlyContribution ?? 0);
  const [years, setYears] = useState<number>(profile?.investmentHorizonYears ?? 10);
  const [annual, setAnnual] = useState<number>(0.06); // 6% default

  useEffect(() => {
    if (profile?.monthlyContribution != null) setMonthly(profile.monthlyContribution);
    if (profile?.investmentHorizonYears != null) setYears(profile.investmentHorizonYears);
  }, [profile?.monthlyContribution, profile?.investmentHorizonYears]);

  const { expected, pessimistic, optimistic, series } = useMemo(() => {
    const exp = futureValueLumpSum(current, annual, years) + futureValueAnnuity(monthly, annual, years);
    const pessRate = Math.max(annual - 0.03, 0);
    const optRate = annual + 0.03;
    const pess = futureValueLumpSum(current, pessRate, years) + futureValueAnnuity(monthly, pessRate, years);
    const opt = futureValueLumpSum(current, optRate, years) + futureValueAnnuity(monthly, optRate, years);

    const points = Array.from({ length: years + 1 }, (_, y) => {
      const v = futureValueLumpSum(current, annual, y) + futureValueAnnuity(monthly, annual, y);
      return { y: `${y}y`, v: Number(v.toFixed(2)) };
    });
    return { expected: exp, pessimistic: pess, optimistic: opt, series: points };
  }, [current, monthly, annual, years]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Goal Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {profile ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-gray-500">Primary goal</div>
                <div className="font-medium">{profile.primaryGoal}</div>
              </div>
              <div>
                <div className="text-gray-500">Horizon</div>
                <div className="font-medium">{years} years</div>
              </div>
              <div>
                <div className="text-gray-500">Monthly contribution</div>
                <div className="font-medium">${monthly.toFixed(0)}</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Add your profile to personalize goals.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scenario Builder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1">Investment horizon (years): {years}</label>
              <Slider min={1} max={50} step={1} value={years} onChange={(e) => setYears(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-sm mb-1">Expected annual return: {(annual * 100).toFixed(1)}%</label>
              <Slider
                min={0}
                max={0.15}
                step={0.005}
                value={annual}
                onChange={(e) => setAnnual(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Projected value (pessimistic)</div>
              <div className="font-medium">${pessimistic.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-gray-500">Projected value (expected)</div>
              <div className="font-medium">${expected.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-gray-500">Projected value (optimistic)</div>
              <div className="font-medium">${optimistic.toFixed(0)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projection</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px] pt-6">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <CartesianGrid strokeDasharray="4 4" />
              <XAxis dataKey="y" />
              <YAxis />
              <ReTooltip />
              <Area type="monotone" dataKey="v" stroke="#10b981" fill="#10b98120" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

