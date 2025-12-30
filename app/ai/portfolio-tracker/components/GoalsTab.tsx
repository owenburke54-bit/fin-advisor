"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Slider } from "@/components/ui/Slider";
import { fmtMoney, fmtPercent } from "@/lib/format";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as ReTooltip, CartesianGrid } from "recharts";

function futureValueLumpSum(present: number, annualRate: number, years: number): number {
  return present * Math.pow(1 + annualRate, years);
}

function futureValueAnnuity(monthlyContribution: number, annualRate: number, years: number): number {
  const n = years * 12;
  const mr = annualRate / 12;
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

  const { expected, pessimistic, optimistic, series, yDomain } = useMemo(() => {
    const exp = futureValueLumpSum(current, annual, years) + futureValueAnnuity(monthly, annual, years);

    const pessRate = Math.max(annual - 0.03, 0);
    const optRate = annual + 0.03;

    const pess = futureValueLumpSum(current, pessRate, years) + futureValueAnnuity(monthly, pessRate, years);
    const opt = futureValueLumpSum(current, optRate, years) + futureValueAnnuity(monthly, optRate, years);

    const points = Array.from({ length: years + 1 }, (_, y) => {
      const v = futureValueLumpSum(current, annual, y) + futureValueAnnuity(monthly, annual, y);
      return { y: `${y}y`, v: Number(v.toFixed(2)), yearNum: y };
    });

    // Rounded Y-axis domain (nice “round number” ticks)
    const vals = points.map((p) => p.v).filter((n) => Number.isFinite(n));
    const min = vals.length ? Math.min(...vals) : 0;
    const max = vals.length ? Math.max(...vals) : 0;

    const range = max - min;
    const pad = range > 0 ? range * 0.08 : Math.max(1000, max * 0.05);
    const rawMin = Math.max(0, min - pad);
    const rawMax = max + pad;

    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawMax, 1))));
    const step = magnitude / 5;

    const roundDown = (x: number) => Math.floor(x / step) * step;
    const roundUp = (x: number) => Math.ceil(x / step) * step;

    const yDomain: [number, number] = [roundDown(rawMin), roundUp(rawMax)];

    return { expected: exp, pessimistic: pess, optimistic: opt, series: points, yDomain };
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
                <div className="font-medium">{fmtMoney(monthly, 0)}</div>
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
              <label className="block text-sm mb-1">Expected annual return: {fmtPercent(annual, 1)}</label>
              <Slider min={0} max={0.15} step={0.005} value={annual} onChange={(e) => setAnnual(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="rounded-lg border bg-white p-3">
              <div className="text-gray-500">Projected value (pessimistic)</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{fmtMoney(pessimistic, 0)}</div>
              <div className="text-xs text-gray-500 mt-1">Assumes {fmtPercent(Math.max(annual - 0.03, 0), 1)}/yr</div>
            </div>

            <div className="rounded-lg border bg-white p-3">
              <div className="text-gray-500">Projected value (expected)</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{fmtMoney(expected, 0)}</div>
              <div className="text-xs text-gray-500 mt-1">Assumes {fmtPercent(annual, 1)}/yr</div>
            </div>

            <div className="rounded-lg border bg-white p-3">
              <div className="text-gray-500">Projected value (optimistic)</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{fmtMoney(optimistic, 0)}</div>
              <div className="text-xs text-gray-500 mt-1">Assumes {fmtPercent(annual + 0.03, 1)}/yr</div>
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
              <YAxis domain={yDomain} tickFormatter={(v: number) => fmtMoney(v, 0)} />

              <ReTooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;

                  const v = Number(payload[0].value ?? 0);

                  return (
                    <div className="rounded-md border bg-white p-3 text-sm shadow-md min-w-[240px]">
                      <div className="font-semibold text-gray-900 mb-2">{label}</div>

                      <div className="space-y-1">
                        <div className="flex justify-between gap-6">
                          <span className="text-gray-600">Projected value</span>
                          <span className="font-semibold text-gray-900">{fmtMoney(v, 2)}</span>
                        </div>

                        <div className="flex justify-between gap-6">
                          <span className="text-gray-600">Assumed return</span>
                          <span className="font-medium text-gray-900">{fmtPercent(annual, 1)}/yr</span>
                        </div>

                        <div className="flex justify-between gap-6">
                          <span className="text-gray-600">Monthly contribution</span>
                          <span className="font-medium text-gray-900">{fmtMoney(monthly, 0)}/mo</span>
                        </div>

                        <div className="flex justify-between gap-6">
                          <span className="text-gray-600">Starting value</span>
                          <span className="font-medium text-gray-900">{fmtMoney(current, 0)}</span>
                        </div>
                      </div>

                      <div className="mt-2 pt-2 border-t text-xs text-gray-500">
                        Educational projection (no fees/taxes; return is hypothetical).
                      </div>
                    </div>
                  );
                }}
              />

              <Area type="monotone" dataKey="v" stroke="#10b981" fill="#10b98120" isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
