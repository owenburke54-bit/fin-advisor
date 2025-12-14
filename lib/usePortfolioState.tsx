"use client";

/* eslint-disable @typescript-eslint/no-empty-function */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPricesForTickers } from "./marketData";
import {
  PortfolioState,
  Position,
  UserProfile,
  AssetClass,
  AccountType,
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
  refreshPrices: () => Promise<void>;
  takeSnapshot: () => void;
  setProfile: (profile: UserProfile) => void;
  addPosition: (p: Position) => void;
  updatePosition: (p: Position) => void;
  deletePosition: (id: string) => void;
  exportJSON: () => string;
  importJSON: (json: string) => void;
  exportCSV: () => string;
  importCSV: (csv: string) => { success: boolean; errors: string[] };
}

export function usePortfolioState(): UsePortfolio {
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

  // auto-fetch prices on first load if any are missing
  useEffect(() => {
    if (loading) return;
    const hasPositions = state.positions.length > 0;
    const missingAny = state.positions.some((p) => typeof p.currentPrice !== "number");
    if (hasPositions && missingAny) {
      // fire-and-forget
      void refreshPrices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
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

  const refreshPrices = useCallback(async () => {
    // Skip CASH to keep $1 NAV behavior
    const tickers = Array.from(
      new Set(
        state.positions
          .filter((p) => !((p.assetClass === "Money Market") && p.ticker?.toUpperCase() === "CASH"))
          .map((p) => p.ticker.trim().toUpperCase()),
      ),
    ).filter(Boolean);
    if (tickers.length === 0) return;
    const data = await fetchPricesForTickers(tickers);
    setState((prev) => {
      const positions = prev.positions.map((p) => {
        if ((p.assetClass === "Money Market") && p.ticker?.toUpperCase() === "CASH") {
          return { ...p, currentPrice: 1 };
        }
        const md = data[p.ticker.toUpperCase()];
        if (!md) return p;
        return {
          ...p,
          currentPrice: md.price,
          name: p.name || md.name || p.ticker,
          sector: p.sector || md.sector,
        };
      });
      return withSnapshot({ ...prev, positions });
    });
  }, [state.positions]);

  const takeSnapshot = useCallback(() => {
    setState((prev) => withSnapshot(prev));
  }, []);

  const exportJSON = useCallback((): string => {
    const { snapshots, ...rest } = state;
    return JSON.stringify(rest, null, 2);
  }, [state]);

  const importJSON = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json) as Partial<PortfolioState>;
      const next: PortfolioState = {
        profile: parsed.profile ?? null,
        positions: parsed.positions ?? [],
        snapshots: state.snapshots, // keep history
        lastUpdated: new Date().toISOString(),
      };
      setState(withSnapshot(next));
    } catch {
      // ignore here; caller can validate first
    }
  }, [state.snapshots]);

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

  const importCSV = useCallback((csv: string) => {
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
        const pos: Position = {
          id: crypto.randomUUID(),
          ticker: String(obj["ticker"] || "").toUpperCase(),
          name: String(obj["name"] || ""),
          assetClass: String(obj["assetclass"] || "Other") as AssetClass,
          accountType: String(obj["accounttype"] || "Other") as AccountType,
          quantity: Number(obj["quantity"] || 0),
          costBasisPerUnit: Number(obj["costbasisperunit"] || 0),
          currentPrice: header.includes("currentprice") ? Number(obj["currentprice"] || NaN) : undefined,
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
    // Merge duplicates: same ticker + accountType
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
          const totalCost =
            existing.costBasisPerUnit * existing.quantity + p.costBasisPerUnit * p.quantity;
          const avgCost = totalQty > 0 ? totalCost / totalQty : 0;
          merged.set(key, {
            ...existing,
            quantity: totalQty,
            costBasisPerUnit: avgCost,
            // Prefer a defined currentPrice, otherwise keep existing
            currentPrice:
              typeof p.currentPrice === "number" && !Number.isNaN(p.currentPrice)
                ? p.currentPrice
                : existing.currentPrice,
            // Keep earliest purchase date
            purchaseDate:
              (existing.purchaseDate && p.purchaseDate
                ? (new Date(existing.purchaseDate) <= new Date(p.purchaseDate) ? existing.purchaseDate : p.purchaseDate)
                : existing.purchaseDate || p.purchaseDate) || undefined,
          });
        }
      }
      const positions = Array.from(merged.values());
      setState((prev) => withSnapshot({ ...prev, positions: [...prev.positions, ...positions] }));
      // populate prices for any rows missing currentPrice
      void refreshPrices();
    }
    return { success: errors.length === 0, errors };
  }, []);

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

  const { diversificationScore, topConcentrations } = useMemo(() => {
    const total = state.positions.reduce((acc, p) => acc + valueForPosition(p), 0);
    if (total <= 0) return { diversificationScore: 0, topConcentrations: [] as { ticker: string; value: number; percent: number }[] };
    const byTicker = new Map<string, number>();
    const classes = new Set<AssetClass>();
    for (const p of state.positions) {
      const v = valueForPosition(p);
      byTicker.set(p.ticker, (byTicker.get(p.ticker) ?? 0) + v);
      classes.add(p.assetClass);
    }
    const shares = Array.from(byTicker.entries()).map(([t, v]) => ({ ticker: t, value: v, percent: v / total }));
    shares.sort((a, b) => b.percent - a.percent);
    const hhi = shares.reduce((acc, s) => acc + s.percent * s.percent, 0); // 0..1 (higher worse)
    const numTickers = byTicker.size;
    const classBonus = Math.min(classes.size / 5, 1); // up to 5 classes counts fully
    // naive score: more tickers, lower concentration, more classes
    const base = Math.min(numTickers / 12, 1) * 0.4 + (1 - hhi) * 0.4 + classBonus * 0.2;
    return { diversificationScore: Math.round(base * 100), topConcentrations: shares.slice(0, 5) };
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
    exportJSON,
    importJSON,
    exportCSV,
    importCSV,
  };
}

