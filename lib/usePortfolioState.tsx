"use client";

/* eslint-disable @typescript-eslint/no-empty-function */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchPricesForTickers } from "./marketData";
import type {
  PortfolioState,
  Position,
  UserProfile,
  AssetClass,
  AccountType,
  Transaction,
} from "./types";
import {
  getInitialState,
  loadState,
  saveState,
  withSnapshot,
  upsertPosition as storageUpsert,
  deletePosition as storageDelete,
  valueForPosition,
} from "./portfolioStorage";

export interface UsePortfolio {
  state: PortfolioState;
  loading: boolean;
  diversificationScore: number;
  topConcentrations: { ticker: string; value: number; percent: number }[];
  refreshPrices: (positionsOverride?: Position[]) => Promise<void>;
  takeSnapshot: () => void;
  setProfile: (profile: UserProfile) => void;
  addPosition: (p: Position) => void;
  updatePosition: (p: Position) => void;
  deletePosition: (id: string) => void;
  clearPositions: () => void;

  // transactions
  setTransactions: (txs: Transaction[]) => void;

  exportJSON: () => string;
  importJSON: (json: string) => void;
  exportCSV: () => string;
  importCSV: (csv: string) => { success: boolean; errors: string[] };
}

const PortfolioContext = createContext<UsePortfolio | null>(null);

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
    setState((prev) => withSnapshot({ ...prev, positions: [] }));
  }, []);

  const setTransactions = useCallback((txs: Transaction[]) => {
    setState((prev) => withSnapshot({ ...prev, transactions: txs }));
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

      setState((prev) => {
        const positions = prev.positions.map((p) => {
          const t = (p.ticker || "").toUpperCase();
          const isCashLike = p.assetClass === "Money Market" || p.assetClass === "Cash";

          const md = data[t];
          if (!md) {
            if (isCashLike && (typeof p.currentPrice !== "number" || !Number.isFinite(p.currentPrice))) {
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

        return withSnapshot({ ...prev, positions });
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
        .split(/\r?\n/))
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
          const isCashLike = assetClass === "Money Market" || assetClass === "Cash";

          const currentPriceRaw =
            header.includes("currentprice") ? Number(obj["currentprice"] || NaN) : NaN;

          const pos: Position = {
            id: crypto.randomUUID(),
            ticker: String(obj["ticker"] || "").toUpperCase(),
            name: String(obj["name"] || ""),
            assetClass,
            accountType: String(obj["accounttype"] || "Other") as AccountType,
            quantity: Number(obj["quantity"] || 0),
            costBasisPerUnit: Number(obj["costbasisperunit"] || 0),
            currentPrice:
              Number.isFinite(currentPriceRaw) ? currentPriceRaw : isCashLike ? 1 : undefined,
            currency: "USD",
            sector: undefined,
            purchaseDate: header.includes("purchasedate")
              ? String(obj["purchasedate"] || "") || undefined
              : undefined,
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

  const { diversificationScore, topConcentrations } = useMemo(() => {
    const total = state.positions.reduce((acc, p) => acc + valueForPosition(p), 0);
    if (total <= 0) {
      return { diversificationScore: 0, topConcentrations: [] as { ticker: string; value: number; percent: number }[] };
    }

    const byTicker = new Map<string, number>();
    const classes = new Set<AssetClass>();

    for (const p of state.positions) {
      const v = valueForPosition(p);
      byTicker.set(p.ticker, (byTicker.get(p.ticker) ?? 0) + v);
      classes.add(p.assetClass);
    }

    const shares = Array.from(byTicker.entries()).map(([t, v]) => ({
      ticker: t,
      value: v,
      percent: v / total,
    }));

    shares.sort((a, b) => b.percent - a.percent);

    const hhi = shares.reduce((acc, s) => acc + s.percent * s.percent, 0);
    const numTickers = byTicker.size;
    const classBonus = Math.min(classes.size / 5, 1);

    const base = Math.min(numTickers / 12, 1) * 0.4 + (1 - hhi) * 0.4 + classBonus * 0.2;

    return {
      diversificationScore: Math.round(base * 100),
      topConcentrations: shares.slice(0, 5),
    };
  }, [state.positions]);

  return {
    state,
    loading,
    diversificationScore,
    topConcentrations,
    refreshPrices,
    takeSnapshot,
    setProfile,
    addPosition,
    updatePosition,
    deletePosition,
    clearPositions,
    setTransactions,
    exportJSON,
    importJSON,
    exportCSV,
    importCSV,
  };
}

/** ✅ Wrap your app/portfolio tracker UI in this provider once */
export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const value = usePortfolioStateImpl();
  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

/** ✅ Use this everywhere instead of isolated state */
export function usePortfolioState(): UsePortfolio {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    throw new Error("usePortfolioState must be used inside <PortfolioProvider />");
  }
  return ctx;
}
