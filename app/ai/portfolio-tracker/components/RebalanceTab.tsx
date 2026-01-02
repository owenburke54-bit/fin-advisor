"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { fmtMoney, fmtNumber } from "@/lib/format";

type Row = {
  ticker: string;
  name?: string;
  price: number | null;
  currentValue: number;
  currentWeight: number; // 0..1
  targetWeight: number; // 0..1
  targetDollars: number;
  buyDollars: number;
  buyShares: number | null;
  postValue: number;
  postWeight: number; // 0..1
};

function safeNum(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export default function RebalanceTab() {
  const { state } = usePortfolioState();

  const [newMoney, setNewMoney] = useState<string>("1000");

  // target weights stored as percentages in UI (0..100), keyed by ticker
  const tickers = useMemo(
    () => state.positions.map((p) => (p.ticker || "").toUpperCase()).filter(Boolean),
    [state.positions]
  );

  const [targetPctByTicker, setTargetPctByTicker] = useState<Record<string, string>>({});

  // Initialize targets to equal weights (only once per ticker set)
  useEffect(() => {
    if (!tickers.length) {
      setTargetPctByTicker({});
      return;
    }

    setTargetPctByTicker((prev) => {
      const next: Record<string, string> = { ...prev };

      const missing = tickers.filter((t) => next[t] === undefined);
      const removed = Object.keys(next).filter((t) => !tickers.includes(t));

      // remove old tickers
      for (const r of removed) delete next[r];

      // set missing to equal weights
      if (missing.length) {
        const eq = 100 / tickers.length;
        for (const t of missing) next[t] = fmtNumber(eq, 2);
      }

      // if all are blank, also reset to equal
      const allEmpty = tickers.every((t) => !String(next[t] ?? "").trim());
      if (allEmpty) {
        const eq = 100 / tickers.length;
        for (const t of tickers) next[t] = fmtNumber(eq, 2);
      }

      return next;
    });
  }, [tickers]);

  const parsedNewMoney = useMemo(() => {
    const n = Number(String(newMoney).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, [newMoney]);

  const { rows, totals, warnings } = useMemo(() => {
    const positions = state.positions || [];

    const items = positions
      .map((p) => {
        const ticker = (p.ticker || "").toUpperCase();
        const qty = Number(p.quantity) || 0;
        const price =
          typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
            ? p.currentPrice
            : typeof p.costBasisPerUnit === "number" && Number.isFinite(p.costBasisPerUnit)
              ? p.costBasisPerUnit
              : null;

        const value = price !== null ? qty * price : 0;

        const rawPct = targetPctByTicker[ticker];
        const pct = Number(String(rawPct ?? "").replace(/[^0-9.\-]/g, ""));
        const targetW = clamp01((Number.isFinite(pct) ? pct : 0) / 100);

        return {
          ticker,
          name: p.name,
          price,
          currentValue: value,
          targetWeight: targetW,
        };
      })
      .filter((x) => x.ticker);

    const curTotal = items.reduce((a, x) => a + x.currentValue, 0);
    const postTotal = curTotal + parsedNewMoney;

    // normalize targets if they don't sum to 1
    const targetSum = items.reduce((a, x) => a + x.targetWeight, 0);
    const canNormalize = targetSum > 0;

    const normItems = items.map((x) => ({
      ...x,
      targetWeight: canNormalize ? x.targetWeight / targetSum : 0,
    }));

    const withWeights = normItems.map((x) => ({
      ...x,
      currentWeight: curTotal > 0 ? x.currentValue / curTotal : 0,
    }));

    // invest-only algorithm:
    // desiredPostValue = targetWeight * postTotal
    // need = desiredPostValue - currentValue
    // buy = max(0, need)
    // BUT total buys cannot exceed newMoney, so scale down if needed.
    const desired = withWeights.map((x) => {
      const desiredPostValue = x.targetWeight * postTotal;
      const need = desiredPostValue - x.currentValue;
      const buyDollars = Math.max(0, need);
      return { ...x, desiredPostValue, buyDollarsRaw: buyDollars };
    });

    const rawBuySum = desired.reduce((a, x) => a + x.buyDollarsRaw, 0);
    const scale = rawBuySum > 0 ? Math.min(1, parsedNewMoney / rawBuySum) : 0;

    const finalRows: Row[] = desired.map((x) => {
      const buyDollars = x.buyDollarsRaw * scale;
      const buyShares = x.price && x.price > 0 ? buyDollars / x.price : null;

      const postValue = x.currentValue + buyDollars;
      const postWeight = postTotal > 0 ? postValue / postTotal : 0;

      return {
        ticker: x.ticker,
        name: x.name,
        price: x.price,
        currentValue: x.currentValue,
        currentWeight: x.currentWeight,
        targetWeight: x.targetWeight,
        targetDollars: x.targetWeight * postTotal,
        buyDollars,
        buyShares,
        postValue,
        postWeight,
      };
    });

    // remainder dollars due to scaling/rounding
    const buySum = finalRows.reduce((a, r) => a + r.buyDollars, 0);
    const remainder = Math.max(0, parsedNewMoney - buySum);

    const warnings: string[] = [];
    if (!positions.length) warnings.push("Add positions first to use the rebalance simulator.");
    if (parsedNewMoney <= 0) warnings.push("Enter a positive dollar amount to invest.");
    if (!canNormalize) warnings.push("Enter target weights (they will auto-normalize if they don’t sum to 100%).");
    if (canNormalize && Math.abs(targetSum - 1) > 0.0001) warnings.push("Targets auto-normalized (didn’t sum to 100%).");
    if (remainder > 0.01 && rawBuySum > 0) warnings.push(`Unallocated cash: ~${fmtMoney(remainder)} (due to invest-only constraint).`);

    // sort by biggest recommended buy first
    finalRows.sort((a, b) => b.buyDollars - a.buyDollars);

    return {
      rows: finalRows,
      totals: { curTotal, postTotal, buySum, remainder, targetSum },
      warnings,
    };
  }, [state.positions, targetPctByTicker, parsedNewMoney]);

  const fillEqual = () => {
    if (!tickers.length) return;
    const eq = 100 / tickers.length;
    const next: Record<string, string> = {};
    for (const t of tickers) next[t] = fmtNumber(eq, 2);
    setTargetPctByTicker(next);
  };

  const fillCurrent = () => {
    // set targets to current weights (based on available prices)
    const positions = state.positions || [];
    const values = positions.map((p) => {
      const ticker = (p.ticker || "").toUpperCase();
      const qty = Number(p.quantity) || 0;
      const price =
        typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
          ? p.currentPrice
          : typeof p.costBasisPerUnit === "number" && Number.isFinite(p.costBasisPerUnit)
            ? p.costBasisPerUnit
            : null;
      const v = price ? qty * price : 0;
      return { ticker, v };
    });

    const total = values.reduce((a, x) => a + x.v, 0);
    const next: Record<string, string> = {};
    for (const { ticker, v } of values) {
      const pct = total > 0 ? (v / total) * 100 : 0;
      if (ticker) next[ticker] = fmtNumber(pct, 2);
    }
    setTargetPctByTicker(next);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>What-if Rebalance Simulator (Invest-only)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="text-sm font-medium text-gray-700">New money to invest</label>
              <Input
                value={newMoney}
                onChange={(e) => setNewMoney(e.target.value)}
                placeholder="e.g., 1000"
                className="mt-1"
                inputMode="decimal"
              />
              <p className="mt-2 text-xs text-gray-500">
                This version only recommends <span className="font-medium">buys</span>. No selling.
              </p>
            </div>

            <div className="md:col-span-2 flex flex-wrap items-end gap-2">
              <Button variant="secondary" onClick={fillEqual} disabled={!tickers.length}>
                Equal weights
              </Button>
              <Button variant="secondary" onClick={fillCurrent} disabled={!tickers.length}>
                Match current weights
              </Button>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
              <ul className="list-disc pl-5 space-y-1">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {tickers.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border bg-white p-4">
                <div className="text-sm font-semibold text-gray-900">Target Weights</div>
                <div className="mt-3 space-y-2">
                  {tickers.map((t) => (
                    <div key={t} className="flex items-center justify-between gap-3">
                      <div className="min-w-[72px] font-mono text-sm text-gray-800">{t}</div>
                      <div className="flex-1">
                        <Input
                          value={targetPctByTicker[t] ?? ""}
                          onChange={(e) => setTargetPctByTicker((prev) => ({ ...prev, [t]: e.target.value }))}
                          placeholder="%"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="w-[46px] text-right text-sm text-gray-500">%</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 text-xs text-gray-500">
                  Tip: targets don’t need to sum to 100% — they’ll auto-normalize.
                </div>
              </div>

              <div className="rounded-xl border bg-white p-4">
                <div className="text-sm font-semibold text-gray-900">Summary</div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="text-gray-600">Current value</div>
                  <div className="text-right font-semibold text-gray-900">{fmtMoney(totals.curTotal)}</div>

                  <div className="text-gray-600">New money</div>
                  <div className="text-right font-semibold text-gray-900">{fmtMoney(parsedNewMoney)}</div>

                  <div className="text-gray-600">Projected value</div>
                  <div className="text-right font-semibold text-gray-900">{fmtMoney(totals.postTotal)}</div>

                  <div className="text-gray-600">Allocated</div>
                  <div className="text-right font-semibold text-gray-900">{fmtMoney(totals.buySum)}</div>

                  <div className="text-gray-600">Unallocated</div>
                  <div className="text-right font-semibold text-gray-900">{fmtMoney(totals.remainder)}</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recommended Buys</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-600">Add positions to see rebalance recommendations.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 border-b">
                    <th className="py-2 pr-3">Ticker</th>
                    <th className="py-2 pr-3">Current Wt</th>
                    <th className="py-2 pr-3">Target Wt</th>
                    <th className="py-2 pr-3">Buy ($)</th>
                    <th className="py-2 pr-3">Buy (sh)</th>
                    <th className="py-2 pr-3">Post Wt</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ticker} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 font-mono font-semibold text-gray-900">{r.ticker}</td>
                      <td className="py-2 pr-3 text-gray-700">{fmtNumber(r.currentWeight * 100, 2)}%</td>
                      <td className="py-2 pr-3 text-gray-700">{fmtNumber(r.targetWeight * 100, 2)}%</td>
                      <td className="py-2 pr-3 font-semibold text-gray-900">{fmtMoney(round2(r.buyDollars))}</td>
                      <td className="py-2 pr-3 text-gray-700">
                        {typeof r.buyShares === "number" ? fmtNumber(r.buyShares, 4) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-gray-700">{fmtNumber(r.postWeight * 100, 2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 text-xs text-gray-500">
                Shares are calculated using each position’s <span className="font-medium">currentPrice</span> (fallback: cost basis).
                This is a what-if tool — no trades are executed.
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
