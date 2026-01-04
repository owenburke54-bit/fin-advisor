"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { fmtMoney, fmtNumber } from "@/lib/format";
import type { AssetClass, Position } from "@/lib/types";
import { valueForPosition } from "@/lib/portfolioStorage";

type Mode = "ticker" | "assetClass";

type PosLite = {
  ticker: string;
  name?: string;
  assetClass: AssetClass;
  qty: number;
  price: number | null;
  value: number;
};

type Row = {
  ticker: string;
  assetClass: AssetClass;
  price: number | null;
  currentValue: number;
  currentWeight: number; // 0..1
  targetWeight: number; // 0..1
  buyDollars: number;
  buyShares: number | null;
  postValue: number;
  postWeight: number; // 0..1
  gapAfter: number; // targetWeight - postWeight (positive = underweight)
};

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function parsePct(input: string): number {
  const n = Number(String(input ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseMoney(input: string): number {
  const n = Number(String(input ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function labelAssetClass(a: AssetClass) {
  return a;
}

function pctStr(w: number, decimals = 2) {
  return `${fmtNumber(w * 100, decimals)}%`;
}

function deltaPctStr(w: number, decimals = 2) {
  const sign = w >= 0 ? "+" : "";
  return `${sign}${fmtNumber(w * 100, decimals)}%`;
}

function MarkerRail(props: { current: number; target: number; after: number }) {
  const current = clamp01(props.current);
  const target = clamp01(props.target);
  const after = clamp01(props.after);

  const leftPct = (x: number) => `${Math.round(x * 1000) / 10}%`; // 0.1% resolution

  return (
    <div className="w-full">
      <div className="relative h-2 w-full rounded-full bg-gray-100 border">
        {/* Current (blue) */}
        <div
          className="absolute top-[-4px] h-4 w-[2px] rounded bg-blue-600"
          style={{ left: leftPct(current), transform: "translateX(-50%)" }}
          title={`Current: ${pctStr(current, 2)}`}
        />
        {/* Target (black) */}
        <div
          className="absolute top-[-5px] h-5 w-[2px] rounded bg-gray-900"
          style={{ left: leftPct(target), transform: "translateX(-50%)" }}
          title={`Target: ${pctStr(target, 2)}`}
        />
        {/* After (emerald) */}
        <div
          className="absolute top-[-4px] h-4 w-[2px] rounded bg-emerald-600"
          style={{ left: leftPct(after), transform: "translateX(-50%)" }}
          title={`After: ${pctStr(after, 2)}`}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>0%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

function hasFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * For rebalance math:
 * - Use `valueForPosition` so Cash/MM formats are always valued correctly.
 * - Keep a "price" purely for converting dollars -> shares (cash-like uses price=1).
 */
function priceForShares(p: Position): number | null {
  const isCashLike = p.assetClass === "Money Market" || p.assetClass === "Cash";
  if (isCashLike) return 1;

  if (hasFiniteNumber(p.currentPrice) && p.currentPrice > 0) return p.currentPrice;
  if (hasFiniteNumber(p.costBasisPerUnit) && p.costBasisPerUnit > 0) return p.costBasisPerUnit;

  return null;
}

export default function RebalanceTab() {
  const { state } = usePortfolioState();

  const [mode, setMode] = useState<Mode>("ticker");
  const [newMoney, setNewMoney] = useState<string>("1000");

  const parsedNewMoney = useMemo(() => parseMoney(newMoney), [newMoney]);

  const positions: PosLite[] = useMemo(() => {
    return (state.positions || [])
      .map((p) => {
        const ticker = (p.ticker || "").toUpperCase().trim();
        if (!ticker) return null;

        const qty = Number(p.quantity) || 0;
        const price = priceForShares(p);

        // ✅ Correct value across equities/crypto AND cash/MM formats
        const value = valueForPosition(p);

        return {
          ticker,
          name: p.name,
          assetClass: p.assetClass,
          qty,
          price,
          value,
        } as PosLite;
      })
      .filter(Boolean) as PosLite[];
  }, [state.positions]);

  const tickers = useMemo(() => positions.map((p) => p.ticker), [positions]);

  const assetClasses = useMemo(() => {
    const set = new Set<AssetClass>();
    for (const p of positions) set.add(p.assetClass);
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [positions]);

  // --- Targets (UI state) ---
  const [targetPctByTicker, setTargetPctByTicker] = useState<Record<string, string>>({});
  const [targetPctByClass, setTargetPctByClass] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!tickers.length) {
      setTargetPctByTicker({});
      return;
    }
    setTargetPctByTicker((prev) => {
      const next: Record<string, string> = { ...prev };

      const removed = Object.keys(next).filter((t) => !tickers.includes(t));
      for (const r of removed) delete next[r];

      const missing = tickers.filter((t) => next[t] === undefined);
      if (missing.length) {
        const eq = 100 / tickers.length;
        for (const t of missing) next[t] = fmtNumber(eq, 2);
      }

      const allEmpty = tickers.every((t) => !String(next[t] ?? "").trim());
      if (allEmpty) {
        const eq = 100 / tickers.length;
        for (const t of tickers) next[t] = fmtNumber(eq, 2);
      }

      return next;
    });
  }, [tickers]);

  useEffect(() => {
    if (!assetClasses.length) {
      setTargetPctByClass({});
      return;
    }

    const total = positions.reduce((a, p) => a + p.value, 0);
    const byClass: Record<string, number> = {};
    for (const p of positions) byClass[p.assetClass] = (byClass[p.assetClass] ?? 0) + p.value;

    setTargetPctByClass((prev) => {
      const next: Record<string, string> = { ...prev };

      const removed = Object.keys(next).filter((c) => !assetClasses.includes(c as AssetClass));
      for (const r of removed) delete next[r];

      const missing = assetClasses.filter((c) => next[c] === undefined);
      if (missing.length) {
        for (const c of missing) {
          const pct = total > 0 ? ((byClass[c] ?? 0) / total) * 100 : 0;
          next[c] = fmtNumber(pct, 2);
        }
      }

      const allEmpty = assetClasses.every((c) => !String(next[c] ?? "").trim());
      if (allEmpty) {
        for (const c of assetClasses) {
          const pct = total > 0 ? ((byClass[c] ?? 0) / total) * 100 : 0;
          next[c] = fmtNumber(pct, 2);
        }
      }

      return next;
    });
  }, [assetClasses, positions]);

  const curTotal = useMemo(() => positions.reduce((a, p) => a + p.value, 0), [positions]);
  const postTotal = curTotal + parsedNewMoney;

  // Convert chosen targets into per-ticker target weights (0..1), normalized
  const tickerTargets = useMemo(() => {
    const targets: Record<string, number> = {};
    if (!positions.length) return targets;

    if (mode === "ticker") {
      let sum = 0;
      for (const t of tickers) {
        const w = clamp01(parsePct(targetPctByTicker[t] ?? "") / 100);
        targets[t] = w;
        sum += w;
      }
      if (sum <= 0) return {};
      for (const t of Object.keys(targets)) targets[t] = targets[t] / sum;
      return targets;
    }

    // assetClass mode:
    const classRaw: Record<string, number> = {};
    let classSum = 0;
    for (const c of assetClasses) {
      const w = clamp01(parsePct(targetPctByClass[c] ?? "") / 100);
      classRaw[c] = w;
      classSum += w;
    }
    if (classSum <= 0) return {};

    const classW: Record<string, number> = {};
    for (const c of assetClasses) classW[c] = classRaw[c] / classSum;

    const valueByClass: Record<string, number> = {};
    for (const p of positions) valueByClass[p.assetClass] = (valueByClass[p.assetClass] ?? 0) + p.value;

    // allocate each class weight across tickers in that class
    for (const p of positions) {
      const classTotal = valueByClass[p.assetClass] ?? 0;
      const sameClassCount = positions.filter((x) => x.assetClass === p.assetClass).length;

      const within = classTotal > 0 ? p.value / classTotal : sameClassCount > 0 ? 1 / sameClassCount : 0;
      targets[p.ticker] = (targets[p.ticker] ?? 0) + classW[p.assetClass] * within;
    }

    const sum = Object.values(targets).reduce((a, w) => a + w, 0);
    if (sum <= 0) return {};
    for (const t of Object.keys(targets)) targets[t] = targets[t] / sum;

    return targets;
  }, [mode, positions, tickers, assetClasses, targetPctByTicker, targetPctByClass]);

  const { rows, warnings, totals } = useMemo(() => {
    const warnings: string[] = [];
    if (!positions.length) warnings.push("Add positions first to use the rebalance simulator.");
    if (parsedNewMoney <= 0) warnings.push("Enter a positive dollar amount to invest.");
    if (postTotal <= 0) warnings.push("Portfolio total is zero — add positions or prices.");

    const targetSum = Object.values(tickerTargets).reduce((a, w) => a + w, 0);
    if (targetSum <= 0 && positions.length) warnings.push("Enter target weights (they will auto-normalize).");

    // NOTE: cash/MM positions now have correct values via valueForPosition()
    const baseRows = positions.map((p) => {
      const currentWeight = curTotal > 0 ? p.value / curTotal : 0;
      const targetWeight = tickerTargets[p.ticker] ?? 0;
      return {
        ticker: p.ticker,
        assetClass: p.assetClass,
        price: p.price,
        currentValue: p.value,
        currentWeight,
        targetWeight,
      };
    });

    // invest-only allocation to move toward targets
    const desired = baseRows.map((r) => {
      const desiredPostValue = r.targetWeight * postTotal;
      const need = desiredPostValue - r.currentValue;
      const buyDollarsRaw = Math.max(0, need);
      return { ...r, buyDollarsRaw };
    });

    const rawBuySum = desired.reduce((a, r) => a + r.buyDollarsRaw, 0);
    const scale = rawBuySum > 0 ? Math.min(1, parsedNewMoney / rawBuySum) : 0;

    const finalRows: Row[] = desired.map((r) => {
      const buyDollars = r.buyDollarsRaw * scale;
      const buyShares = r.price && r.price > 0 ? buyDollars / r.price : null;
      const postValue = r.currentValue + buyDollars;
      const postWeight = postTotal > 0 ? postValue / postTotal : 0;
      const gapAfter = (r.targetWeight ?? 0) - postWeight;

      return {
        ticker: r.ticker,
        assetClass: r.assetClass,
        price: r.price,
        currentValue: r.currentValue,
        currentWeight: r.currentWeight,
        targetWeight: r.targetWeight,
        buyDollars,
        buyShares,
        postValue,
        postWeight,
        gapAfter,
      };
    });

    const buySum = finalRows.reduce((a, r) => a + r.buyDollars, 0);
    const remainder = Math.max(0, parsedNewMoney - buySum);

    if (remainder > 0.01 && rawBuySum > 0) {
      warnings.push(`Unallocated cash: ~${fmtMoney(remainder)} (invest-only constraint).`);
    }

    finalRows.sort((a, b) => b.buyDollars - a.buyDollars);

    return {
      rows: finalRows,
      warnings,
      totals: { curTotal, postTotal, buySum, remainder, targetSum },
    };
  }, [positions, parsedNewMoney, curTotal, postTotal, tickerTargets]);

  // Class-level before/after (works in both modes)
  const classSummary = useMemo(() => {
    if (!positions.length) return [];

    const curByClass: Record<string, number> = {};
    for (const p of positions) curByClass[p.assetClass] = (curByClass[p.assetClass] ?? 0) + p.value;

    const postByClass: Record<string, number> = {};
    for (const r of rows) postByClass[r.assetClass] = (postByClass[r.assetClass] ?? 0) + r.postValue;

    let targetWByClass: Record<string, number> = {};

    if (mode === "assetClass") {
      const raw: Record<string, number> = {};
      let sum = 0;
      for (const c of assetClasses) {
        const w = clamp01(parsePct(targetPctByClass[c] ?? "") / 100);
        raw[c] = w;
        sum += w;
      }
      if (sum > 0) {
        targetWByClass = {};
        for (const c of assetClasses) targetWByClass[c] = (raw[c] ?? 0) / sum;
      }
    } else {
      const implied: Record<string, number> = {};
      for (const p of positions) {
        implied[p.assetClass] = (implied[p.assetClass] ?? 0) + (tickerTargets[p.ticker] ?? 0);
      }
      targetWByClass = implied;
    }

    const allClasses = Array.from(new Set<AssetClass>(assetClasses)).sort((a, b) => a.localeCompare(b));

    return allClasses
      .map((c) => {
        const curW = curTotal > 0 ? (curByClass[c] ?? 0) / curTotal : 0;
        const tgtW = targetWByClass[c] ?? 0;
        const postW = postTotal > 0 ? (postByClass[c] ?? 0) / postTotal : 0;
        const gapAfter = tgtW - postW;
        return { assetClass: c, curW, tgtW, postW, gapAfter };
      })
      .sort((a, b) => Math.abs(b.gapAfter) - Math.abs(a.gapAfter));
  }, [positions, rows, assetClasses, curTotal, postTotal, mode, targetPctByClass, tickerTargets]);

  // Quick-fill buttons
  const fillEqualTickers = () => {
    if (!tickers.length) return;
    const eq = 100 / tickers.length;
    const next: Record<string, string> = {};
    for (const t of tickers) next[t] = fmtNumber(eq, 2);
    setTargetPctByTicker(next);
  };

  const fillCurrentTickers = () => {
    const next: Record<string, string> = {};
    for (const p of positions) {
      const pct = curTotal > 0 ? (p.value / curTotal) * 100 : 0;
      next[p.ticker] = fmtNumber(pct, 2);
    }
    setTargetPctByTicker(next);
  };

  const fillCurrentClasses = () => {
    const byClass: Record<string, number> = {};
    for (const p of positions) byClass[p.assetClass] = (byClass[p.assetClass] ?? 0) + p.value;

    const next: Record<string, string> = {};
    for (const c of assetClasses) {
      const pct = curTotal > 0 ? ((byClass[c] ?? 0) / curTotal) * 100 : 0;
      next[c] = fmtNumber(pct, 2);
    }
    setTargetPctByClass(next);
  };

  const fillEqualClasses = () => {
    if (!assetClasses.length) return;
    const eq = 100 / assetClasses.length;
    const next: Record<string, string> = {};
    for (const c of assetClasses) next[c] = fmtNumber(eq, 2);
    setTargetPctByClass(next);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>What-if Rebalance Simulator (Invest-only)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 rounded-full border bg-white px-2 py-1 text-sm">
              <button
                type="button"
                className={`px-3 py-1 rounded-full font-semibold transition ${
                  mode === "ticker" ? "bg-black text-white" : "text-gray-700 hover:bg-gray-100"
                }`}
                onClick={() => setMode("ticker")}
              >
                By Ticker
              </button>
              <button
                type="button"
                className={`px-3 py-1 rounded-full font-semibold transition ${
                  mode === "assetClass" ? "bg-black text-white" : "text-gray-700 hover:bg-gray-100"
                }`}
                onClick={() => setMode("assetClass")}
              >
                By Asset Class
              </button>
            </div>

            <div className="text-xs text-gray-500">
              This version only recommends <span className="font-medium">buys</span>. No selling.
            </div>
          </div>

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
            </div>

            <div className="md:col-span-2 flex flex-wrap items-end gap-2">
              {mode === "ticker" ? (
                <>
                  <Button variant="secondary" onClick={fillEqualTickers} disabled={!tickers.length}>
                    Equal weights (tickers)
                  </Button>
                  <Button variant="secondary" onClick={fillCurrentTickers} disabled={!tickers.length}>
                    Match current (tickers)
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={fillEqualClasses} disabled={!assetClasses.length}>
                    Equal weights (classes)
                  </Button>
                  <Button variant="secondary" onClick={fillCurrentClasses} disabled={!assetClasses.length}>
                    Match current (classes)
                  </Button>
                </>
              )}
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

          {positions.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border bg-white p-4">
                <div className="text-sm font-semibold text-gray-900">
                  Target Weights ({mode === "ticker" ? "Tickers" : "Asset Classes"})
                </div>

                <div className="mt-3 space-y-2">
                  {mode === "ticker" ? (
                    tickers.map((t) => (
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
                    ))
                  ) : (
                    assetClasses.map((c) => (
                      <div key={c} className="flex items-center justify-between gap-3">
                        <div className="min-w-[120px] text-sm text-gray-800">{labelAssetClass(c)}</div>
                        <div className="flex-1">
                          <Input
                            value={targetPctByClass[c] ?? ""}
                            onChange={(e) => setTargetPctByClass((prev) => ({ ...prev, [c]: e.target.value }))}
                            placeholder="%"
                            inputMode="decimal"
                          />
                        </div>
                        <div className="w-[46px] text-right text-sm text-gray-500">%</div>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-3 text-xs text-gray-500">
                  Tip: targets don’t need to sum to 100% — they’ll auto-normalize.
                  {mode === "assetClass" ? " Output will still be ticker-level buys." : ""}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Targets vs Current vs After (Asset Classes)</CardTitle>

            <div className="flex items-center gap-3 text-xs text-gray-600">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded bg-blue-600" />
                <span>Current</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded bg-gray-900" />
                <span>Target</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded bg-emerald-600" />
                <span>After</span>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {classSummary.length === 0 ? (
            <p className="text-sm text-gray-600">Add positions to see class-level progress.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 border-b">
                    <th className="py-2 pr-3">Asset Class</th>
                    <th className="py-2 pr-3">Current</th>
                    <th className="py-2 pr-3">Target</th>
                    <th className="py-2 pr-3">After</th>
                    <th className="py-2 pr-3">Δ to Target</th>
                    <th className="py-2 pr-3 w-[220px]">Visual</th>
                  </tr>
                </thead>
                <tbody>
                  {classSummary.map((r) => {
                    const delta = r.gapAfter; // target - after
                    return (
                      <tr key={r.assetClass} className="border-b last:border-b-0">
                        <td className="py-2 pr-3 font-medium text-gray-900">{labelAssetClass(r.assetClass)}</td>
                        <td className="py-2 pr-3 text-gray-700">{pctStr(r.curW, 2)}</td>
                        <td className="py-2 pr-3 text-gray-700">{pctStr(r.tgtW, 2)}</td>
                        <td className="py-2 pr-3 text-gray-700">{pctStr(r.postW, 2)}</td>
                        <td
                          className={`py-2 pr-3 font-semibold ${delta >= 0 ? "text-emerald-600" : "text-red-600"}`}
                          title="Positive means still underweight"
                        >
                          {deltaPctStr(delta, 2)}
                        </td>
                        <td className="py-2 pr-3">
                          <MarkerRail current={r.curW} target={r.tgtW} after={r.postW} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-3 text-xs text-gray-500">
                Δ to Target = <span className="font-medium">Target − After</span>. Positive means still underweight.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recommended Buys (Ticker-level)</CardTitle>
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
                    <th className="py-2 pr-3">Class</th>
                    <th className="py-2 pr-3">Current Wt</th>
                    <th className="py-2 pr-3">Target Wt</th>
                    <th className="py-2 pr-3">Buy ($)</th>
                    <th className="py-2 pr-3">Buy (sh)</th>
                    <th className="py-2 pr-3">Post Wt</th>
                    <th className="py-2 pr-3">Δ to Target</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ticker} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 font-mono font-semibold text-gray-900">{r.ticker}</td>
                      <td className="py-2 pr-3 text-gray-700">{labelAssetClass(r.assetClass)}</td>
                      <td className="py-2 pr-3 text-gray-700">{fmtNumber(r.currentWeight * 100, 2)}%</td>
                      <td className="py-2 pr-3 text-gray-700">{fmtNumber(r.targetWeight * 100, 2)}%</td>
                      <td className="py-2 pr-3 font-semibold text-gray-900">{fmtMoney(round2(r.buyDollars))}</td>
                      <td className="py-2 pr-3 text-gray-700">
                        {typeof r.buyShares === "number" ? fmtNumber(r.buyShares, 4) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-gray-700">{fmtNumber(r.postWeight * 100, 2)}%</td>
                      <td
                        className={`py-2 pr-3 font-semibold ${
                          r.gapAfter >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                        title="Positive means still underweight"
                      >
                        {deltaPctStr(r.gapAfter, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 text-xs text-gray-500">
                Shares use <span className="font-medium">currentPrice</span> (fallback: cost basis; cash/MM uses $1/share).
                This is a what-if tool — no trades are executed.
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
