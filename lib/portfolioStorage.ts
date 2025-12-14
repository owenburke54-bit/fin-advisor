import { AccountType, AssetClass, PortfolioSnapshot, PortfolioState, Position } from "./types";

export const STORAGE_KEY = "portfolio-tracker-state-v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadState(): PortfolioState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return safeParse<PortfolioState>(raw);
}

export function saveState(state: PortfolioState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getInitialState(): PortfolioState {
  return {
    profile: null,
    positions: [],
    snapshots: [],
    lastUpdated: undefined,
  };
}

/**
 * Compute the current value of a position with special handling for cash/money‑market.
 * Rules:
 *  - For non‑MM assets, prefer currentPrice; if missing, use costBasisPerUnit.
 *  - For Money Market/Cash (assetClass === "Money Market"):
 *      • If ticker is "CASH" (cash sweep), always treat as $1 NAV and value equals the balance.
 *      • If quantity represents balance (quantity > 1 and currentPrice≈1), value = quantity.
      • Otherwise if currentPrice is a number, value = quantity * currentPrice.
      • Fallback to costBasisPerUnit * quantity.
 */
export function valueForPosition(p: Position): number {
  const isMM = p.assetClass === "Money Market";

  // Handle plain cash explicitly – always $1 NAV, balance in costBasisPerUnit or qty
  if (isMM && typeof (p as any).ticker === "string" && ((p as any).ticker as string).toUpperCase() === "CASH") {
    const bal = typeof p.costBasisPerUnit === "number" && p.costBasisPerUnit > 0 ? p.costBasisPerUnit : Number(p.quantity) || 0;
    return Number.isFinite(bal) ? bal : 0;
  }

  // Money market funds (e.g., SPAXX) or other MM-like: support both styles
  if (isMM) {
    const q = Number(p.quantity) || 0;
    const price =
      typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice) ? (p.currentPrice as number) : undefined;
    const hasBalance =
      typeof p.costBasisPerUnit === "number" && Number.isFinite(p.costBasisPerUnit) && (p.costBasisPerUnit as number) > 0;
    // Style 1: single-share with NAV≈1 and balance stored in costBasisPerUnit
    if (q === 1 && hasBalance && (price === undefined || Math.abs(price - 1) < 1e-9)) {
      return Number(p.costBasisPerUnit);
    }
    // Style 2: balance encoded in quantity with NAV≈1
    if (price === undefined || Math.abs(price - 1) < 1e-9) {
      return q;
    }
    // Non-1 price provided → use q * price
    return q * price;
  }

  const unitPrice = typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice) ? (p.currentPrice as number) : (p.costBasisPerUnit ?? 0);
  return (Number(p.quantity) || 0) * unitPrice;
}

export function computeSnapshot(state: PortfolioState): PortfolioSnapshot {
  const now = new Date().toISOString();

  const byAssetClass = {} as Record<AssetClass, number>;
  const byAccountType = {} as Record<AccountType, number>;

  let totalValue = 0;
  let totalCost = 0;
  for (const pos of state.positions) {
    const value = valueForPosition(pos);
    totalValue += value;
    totalCost += pos.costBasisPerUnit * pos.quantity;
    byAssetClass[pos.assetClass] = (byAssetClass[pos.assetClass] ?? 0) + value;
    byAccountType[pos.accountType] = (byAccountType[pos.accountType] ?? 0) + value;
  }
  const totalGainLossDollar = totalValue - totalCost;
  const totalGainLossPercent = totalCost > 0 ? (totalGainLossDollar / totalCost) * 100 : 0;

  return {
    timestamp: now,
    totalValue,
    totalGainLossDollar,
    totalGainLossPercent,
    byAssetClass,
    byAccountType,
  };
}

export function withSnapshot(state: PortfolioState): PortfolioState {
  const snap = computeSnapshot(state);
  return {
    ...state,
    snapshots: [...state.snapshots, snap],
    lastUpdated: snap.timestamp,
  };
}

export function upsertPosition(state: PortfolioState, position: Position): PortfolioState {
  const idx = state.positions.findIndex((p) => p.id === position.id);
  const positions =
    idx === -1
      ? [...state.positions, position]
      : state.positions.map((p, i) => (i === idx ? position : p));
  const next: PortfolioState = { ...state, positions };
  return withSnapshot(next);
}

export function deletePosition(state: PortfolioState, id: string): PortfolioState {
  const positions = state.positions.filter((p) => p.id !== id);
  const next: PortfolioState = { ...state, positions };
  return withSnapshot(next);
}

