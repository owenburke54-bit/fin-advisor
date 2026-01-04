// lib/usePortfolioState.ts
"use client";

/* eslint-disable @typescript-eslint/no-empty-function */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchPricesForTickers } from "./marketData";
import type { PortfolioState, Position, UserProfile, AssetClass, AccountType, Transaction } from "./types";
import { isBondLike, isCashLike, isEquityLike } from "./types";
import {
  getInitialState,
  loadState,
  saveState,
  withSnapshot,
  upsertPosition as storageUpsert,
  deletePosition as storageDelete,
  valueForPosition,
} from "./portfolioStorage";

export type DiversificationTier = "Excellent" | "Good" | "Fair" | "Poor";

export type DiversificationDetails = {
  tier: DiversificationTier;
  tierHint: string;

  topHoldingTicker: string | null;
  topHoldingPct: number; // 0..1
  top3Pct: number; // 0..1

  buckets: {
    equity: number; // 0..1
    bonds: number; // 0..1
    cash: number; // 0..1
    other: number; // 0..1
  };

  why: string[]; // actionable bullets
};

type SetOpts = { snapshot?: boolean };

export interface UsePortfolio {
  state: PortfolioState;
  loading: boolean;

  diversificationScore: number;
  diversificationDetails: DiversificationDetails;
  topConcentrations: { ticker: string; value: number; percent: number }[];

  refreshPrices: (positionsOverride?: Position[]) => Promise<void>;
  takeSnapshot: () => void;
  setProfile: (profile: UserProfile) => void;

  addPosition: (p: Position) => void;
  updatePosition: (p: Position) => void;
  deletePosition: (id: string) => void;
  clearPositions: () => void;

  // ✅ direct setters
  setPositions: (positions: Position[], opts?: SetOpts) => void;
  setTransactions: (txs: Transaction[], opts?: SetOpts) => void;

  // ✅ safe transaction helpers (prevents accidental positions wipe)
  addTransaction: (tx: Transaction, opts?: SetOpts) => void;
  deleteTransaction: (id: string, opts?: SetOpts) => void;
  updateTransaction: (tx: Transaction, opts?: SetOpts) => void;

  exportJSON: () => string;
  importJSON: (json: string) => void;
  exportCSV: () => string;
  importCSV: (csv: string) => { success: boolean; errors: string[] };
}

const PortfolioContext = createContext<UsePortfolio | null>(null);

function tierForScore(score: number): { tier: DiversificationTier; tierHint: string } {
  if (score >= 85) return { tier: "Excellent", tierHint: "Very well diversified across holdings and asset classes." };
  if (score >= 70) return { tier: "Good", tierHint: "Solid diversification with a few areas to improve." };
  if (score >= 40) return { tier: "Fair", tierHint: "Moderately concentrated—rebalancing would help." };
  return { tier: "Poor", tierHint: "Highly concentrated—consider spreading risk across more holdings/classes." };
}

function pctFmt(p: number) {
  return `${Math.round(p * 100)}%`;
}

// Keep in sync with TransactionsTab (baseline positions seed used for tx rebuild)
const POS_SEED_KEY = "fin-advisor:portfolioTracker:positionsSeed:v1";
function clearPositionsSeed() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(POS_SEED_KEY);
  } catch {
    // ignore
  }
}

function usePortfolioStateImpl(): UsePortfolio {
  const [state, setState] = useState<PortfolioState>(getInitialState());
  const [loading, setLoading] = useState(true);

  // hydrate from localStorage
  useEffect(() => {
    const loaded = loadState();
    if (loaded) setState(loaded);
    setLoading(false);
  }, []);

  // persist on changes
  useEffect(() => {
    if (!loading) saveState(state);
  }, [state, loading]);

  const setProfile = useCallback((profile: UserProfile) => {
    setState((prev) => withSnapshot({ ...prev, profile }));
  }, []);

  const addPosition = useCallback((p: Position) => {
    setState((prev) => storageUpsert(prev, p));
  }, []);

  const updatePosition = useCallback((p: Position) => {
    setState((prev) => storageUpsert(prev, p));
  }, []);

  const deletePosition = useCallback((id: string) => {
    setState((prev) => storageDelete(prev, id));
  }, []);

  const clearPositions = useCallback(() => {
    // If the user wipes positions, any prior tx baseline seed is no longer valid.
    clearPositionsSeed();
    setState((prev) => withSnapshot({ ...prev, positions: [] }));
  }, []);

  // ✅ direct setters (snapshot default = true for user-visible actions)
  const setPositions = useCallback((positions: Position[], opts?: SetOpts) => {
    const snap = opts?.snapshot ?? true;
    setState((prev) => {
      const next = { ...prev, positions };
      return snap ? withSnapshot(next) : next;
    });
  }, []);

  const setTransactions = useCallback((txs: Transaction[], opts?: SetOpts) => {
    const snap = opts?.snapshot ?? true;

    // If user clears transactions, tx baseline seed should be cleared too.
    if (!txs || txs.length === 0) clearPositionsSeed();

    setState((prev) => {
      const next = { ...prev, transactions: txs };
      return snap ? withSnapshot(next) : next;
    });
  }, []);

  // ✅ SAFE transaction helpers (always merges via prev state)
  const addTransaction = useCallback((tx: Transaction, opts?: SetOpts) => {
    const snap = opts?.snapshot ?? true;
    setState((prev) => {
      const next = { ...prev, transactions: [...(prev.transactions ?? []), tx] };
      return snap ? withSnapshot(next) : next;
    });
  }, []);

  const deleteTransaction = useCallback((id: string, opts?: SetOpts) => {
    const snap = opts?.snapshot ?? true;
    setState((prev) => {
      const nextTxs = (prev.transactions ?? []).filter((t) => t.id !== id);

      // If last tx removed, clear baseline seed.
      if (nextTxs.length === 0) clearPositionsSeed();

      const next = { ...prev, transactions: nextTxs };
      return snap ? withSnapshot(next) : next;
    });
  }, []);

  const updateTransaction = useCallback((tx: Transaction, opts?: SetOpts) => {
    const snap = opts?.snapshot ?? true;
    setState((prev) => {
      const nextTxs = (prev.transactions ?? []).map((t) => (t.id === tx.id ? tx : t));
      const next = { ...prev, transactions: nextTxs };
      return snap ? withSnapshot(next) : next;
    });
  }, []);

  const refreshPrices = useCallback(
    async (positionsOverride?: Position[]) => {
      const positionsToUse = positionsOverride ?? state.positions;

      const tickers = Array.from(
        new Set(
          positionsToUse
            .map((p) => (p.ticker || "").trim().toUpperCase())
            .filter(Boolean),
        ),
      );

      if (tickers.length === 0) return;

      const data = await fetchPricesForTickers(tickers);

      // ✅ IMPORTANT: do NOT snapshot on price refresh (prevents snapshot spam)
      setState((prev) => {
        const positions = prev.positions.map((p) => {
          const t = (p.ticker || "").toUpperCase();
          const isCashLikeLocal = p.assetClass === "Money Market" || p.assetClass === "Cash";

          const md = data[t];
          if (!md) {
            if (isCashLikeLocal && (typeof p.currentPrice !== "number" || !Number.isFinite(p.currentPrice))) {
              return { ...p, currentPrice: 1 };
            }
            return p;
          }

          return {
            ...p,
            currentPrice: md.price,
            name: p.name || md.name || p.ticker,
            sector: p.sector || md.sector,
          };
        });

        return { ...prev, positions };
      });
    },
    [state.positions],
  );

  // auto-fetch prices when positions exist and any are missing prices
  useEffect(() => {
    if (loading) return;
    if (state.positions.length === 0) return;

    const missingAny = state.positions.some(
      (p) => typeof p.currentPrice !== "number" || !Number.isFinite(p.currentPrice),
    );

    if (missingAny) {
      void refreshPrices(state.positions);
    }
  }, [loading, state.positions, refreshPrices]);

  const takeSnapshot = useCallback(() => {
    setState((prev) => withSnapshot(prev));
  }, []);

  const exportJSON = useCallback((): string => {
    const { snapshots, ...rest } = state;
    return JSON.stringify(rest, null, 2);
  }, [state]);

  const importJSON = useCallback(
    (json: string) => {
      try {
        const parsed = JSON.parse(json) as Partial<PortfolioState>;

        // New imported dataset => any tx-baseline seed is stale.
        clearPositionsSeed();

        const next: PortfolioState = {
          profile: parsed.profile ?? null,
          positions: parsed.positions ?? [],
          transactions: parsed.transactions ?? [],
          snapshots: state.snapshots, // keep history
          lastUpdated: new Date().toISOString(),
        };

        setState(withSnapshot(next));
        void refreshPrices(next.positions);
      } catch {
        // ignore
      }
    },
    [state.snapshots, refreshPrices],
  );

  function csvEscape(v: string | number): string {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const exportCSV = useCallback((): string => {
    const header = [
      "ticker",
      "name",
      "assetClass",
      "accountType",
      "quantity",
      "costBasisPerUnit",
      "purchaseDate",
      "currentPrice",
    ].join(",");

    const lines = state.positions.map((p) =>
      [
        p.ticker,
        p.name ?? "",
        p.assetClass,
        p.accountType,
        p.quantity,
        p.costBasisPerUnit,
        p.purchaseDate ?? "",
        typeof p.currentPrice === "number" ? p.currentPrice : "",
      ]
        .map(csvEscape)
        .join(","),
    );

    return [header, ...lines].join("\n");
  }, [state.positions]);

  function splitCsvRow(row: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
      const ch = row[i];

      if (inQuotes) {
        if (ch === '"' && row[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          result.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }

    result.push(current);
    return result.map((s) => s.trim());
  }

  const importCSV = useCallback(
    (csv: string) => {
      const errors: string[] = [];

      const rows = csv
        .split(/\r?\n/)
        .map((r) => r.trim())
        .filter(Boolean);

      if (rows.length <= 1) {
        return { success: false, errors: ["CSV appears empty"] };
      }

      const header = rows[0].split(",").map((h) => h.trim().toLowerCase());
      const required = ["ticker", "name", "assetclass", "accounttype", "quantity", "costbasisperunit"];

      for (const r of required) {
        if (!header.includes(r)) {
          return { success: false, errors: [`Missing column: ${r}`] };
        }
      }

      const parsedPositions: Position[] = [];

      for (let i = 1; i < rows.length; i++) {
        const cols = splitCsvRow(rows[i]);

        try {
          const obj = Object.fromEntries(header.map((h, idx) => [h, cols[idx] ?? ""]));

          const assetClass = String(obj["assetclass"] || "Other") as AssetClass;
          const isCashLikeLocal = assetClass === "Money Market" || assetClass === "Cash";

          const currentPriceRaw = header.includes("currentprice") ? Number(obj["currentprice"] || NaN) : NaN;

          const pos: Position = {
            id: crypto.randomUUID(),
            ticker: String(obj["ticker"] || "").toUpperCase(),
            name: String(obj["name"] || ""),
            assetClass,
            accountType: String(obj["accounttype"] || "Other") as AccountType,
            quantity: Number(obj["quantity"] || 0),
            costBasisPerUnit: Number(obj["costbasisperunit"] || 0),
            currentPrice: Number.isFinite(currentPriceRaw) ? currentPriceRaw : isCashLikeLocal ? 1 : undefined,
            currency: "USD",
            sector: undefined,
            purchaseDate: header.includes("purchasedate") ? String(obj["purchasedate"] || "") || undefined : undefined,
            createdAt: new Date().toISOString(),
          };

          if (!pos.ticker || pos.quantity < 0 || pos.costBasisPerUnit < 0) {
            throw new Error("Invalid data");
          }

          parsedPositions.push(pos);
        } catch {
          errors.push(`Row ${i + 1}: invalid`);
        }
      }

      if (parsedPositions.length > 0) {
        const merged = new Map<string, Position>();

        for (const p of parsedPositions) {
          if (p.quantity === 0) continue;
          const key = `${p.ticker.toUpperCase()}|${p.accountType}`;

          const existing = merged.get(key);
          if (!existing) {
            merged.set(key, { ...p });
          } else {
            const totalQty = existing.quantity + p.quantity;
            const totalCost = existing.costBasisPerUnit * existing.quantity + p.costBasisPerUnit * p.quantity;
            const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

            merged.set(key, {
              ...existing,
              quantity: totalQty,
              costBasisPerUnit: avgCost,
              currentPrice:
                typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
                  ? p.currentPrice
                  : existing.currentPrice,
              purchaseDate:
                (existing.purchaseDate && p.purchaseDate
                  ? new Date(existing.purchaseDate) <= new Date(p.purchaseDate)
                    ? existing.purchaseDate
                    : p.purchaseDate
                  : existing.purchaseDate || p.purchaseDate) || undefined,
            });
          }
        }

        const positionsToAdd = Array.from(merged.values());
        const combined = [...state.positions, ...positionsToAdd];

        setState((prev) =>
          withSnapshot({
            ...prev,
            positions: combined,
          }),
        );

        void refreshPrices(combined);
      }

      return { success: errors.length === 0, errors };
    },
    [refreshPrices, state.positions],
  );

  const { diversificationScore, diversificationDetails, topConcentrations } = useMemo(() => {
    const total = state.positions.reduce((acc, p) => acc + valueForPosition(p), 0);

    const empty: DiversificationDetails = {
      tier: "Poor",
      tierHint: "Add positions to compute diversification details.",
      topHoldingTicker: null,
      topHoldingPct: 0,
      top3Pct: 0,
      buckets: { equity: 0, bonds: 0, cash: 0, other: 0 },
      why: [],
    };

    if (total <= 0) {
      return {
        diversificationScore: 0,
        diversificationDetails: empty,
        topConcentrations: [] as { ticker: string; value: number; percent: number }[],
      };
    }

    const byTicker = new Map<string, number>();
    const classes = new Set<AssetClass>();

    let equity = 0;
    let bonds = 0;
    let cash = 0;
    let other = 0;

    for (const p of state.positions) {
      const v = valueForPosition(p);
      byTicker.set(p.ticker, (byTicker.get(p.ticker) ?? 0) + v);
      classes.add(p.assetClass);

      if (isEquityLike(p.assetClass)) equity += v;
      else if (isBondLike(p.assetClass)) bonds += v;
      else if (isCashLike(p.assetClass)) cash += v;
      else other += v;
    }

    const shares = Array.from(byTicker.entries()).map(([t, v]) => ({
      ticker: t,
      value: v,
      percent: v / total,
    }));

    shares.sort((a, b) => b.percent - a.percent);

    const top1 = shares[0];
    const top3Pct = shares.slice(0, 3).reduce((acc, s) => acc + s.percent, 0);

    const hhi = shares.reduce((acc, s) => acc + s.percent * s.percent, 0);
    const numTickers = byTicker.size;
    const classBonus = Math.min(classes.size / 5, 1);

    const base = Math.min(numTickers / 12, 1) * 0.4 + (1 - hhi) * 0.4 + classBonus * 0.2;
    const score = Math.round(base * 100);

    const { tier, tierHint } = tierForScore(score);

    const why: string[] = [];

    const top1Pct = top1?.percent ?? 0;
    if (top1Pct > 0.2) why.push(`Top holding is ${pctFmt(top1Pct)} (${top1?.ticker ?? "N/A"}). Target: < 20%.`);
    else if (top1Pct > 0.1)
      why.push(`Top holding is ${pctFmt(top1Pct)} (${top1?.ticker ?? "N/A"}). Consider < 10–20% range.`);

    if (top3Pct > 0.6) why.push(`Top 3 holdings are ${pctFmt(top3Pct)}. Target: < 60%.`);
    else if (top3Pct > 0.45) why.push(`Top 3 holdings are ${pctFmt(top3Pct)}. Consider adding more positions over time.`);

    const cashPct = total > 0 ? cash / total : 0;
    if (cashPct > 0.25)
      why.push(`Cash/MM is ${pctFmt(cashPct)}. Target (typical): ~5–15% unless saving for near-term goals.`);
    else if (cashPct > 0.15)
      why.push(`Cash/MM is ${pctFmt(cashPct)}. Consider deploying some into diversified funds if appropriate.`);

    const bondsPct = total > 0 ? bonds / total : 0;
    if (bondsPct === 0 && (state.profile?.riskLevel ?? 3) <= 2) {
      why.push(`Bonds are ${pctFmt(bondsPct)}. If your risk is conservative, consider adding some fixed income for stability.`);
    }

    if (why.length === 0) {
      why.push("Your concentrations and asset mix look reasonably balanced for the number of holdings.");
    }

    const details: DiversificationDetails = {
      tier,
      tierHint,
      topHoldingTicker: top1?.ticker ?? null,
      topHoldingPct: top1Pct,
      top3Pct,
      buckets: {
        equity: total ? equity / total : 0,
        bonds: total ? bonds / total : 0,
        cash: total ? cash / total : 0,
        other: total ? other / total : 0,
      },
      why,
    };

    return {
      diversificationScore: score,
      diversificationDetails: details,
      topConcentrations: shares.slice(0, 5),
    };
  }, [state.positions, state.profile?.riskLevel]);

  return {
    state,
    loading,
    diversificationScore,
    diversificationDetails,
    topConcentrations,
    refreshPrices,
    takeSnapshot,
    setProfile,
    addPosition,
    updatePosition,
    deletePosition,
    clearPositions,
    setPositions,
    setTransactions,
    addTransaction,
    deleteTransaction,
    updateTransaction,
    exportJSON,
    importJSON,
    exportCSV,
    importCSV,
  };
}

/** Wrap your app/portfolio tracker UI in this provider once */
export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const value = usePortfolioStateImpl();
  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

/** Use this everywhere instead of isolated state */
export function usePortfolioState(): UsePortfolio {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    throw new Error("usePortfolioState must be used inside <PortfolioProvider />");
  }
  return ctx;
}
