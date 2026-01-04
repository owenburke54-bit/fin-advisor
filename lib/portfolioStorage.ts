import {
  AccountType,
  AssetClass,
  PortfolioSnapshot,
  PortfolioState,
  Position,
} from "./types";

export const STORAGE_KEY = "portfolio-tracker-state-v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isCashLikePosition(p: Position): boolean {
  return p.assetClass === "Money Market" || p.assetClass === "Cash";
}

/**
 * For Money Market / Cash we treat value as "current balance".
 *
 * Supported storage styles:
 *  A) qty=1, costBasisPerUnit=initialBalance, currentPrice=currentBalance
 *  B) qty=1, costBasisPerUnit=balance, currentPrice≈1 (legacy)
 *  C) qty=balance, currentPrice≈1 (legacy alt)
 *
 * This helper returns the *current balance* robustly across those.
 */
function cashLikeValue(p: Position): number {
  const qty = Number(p.quantity) || 0;
  const cp = isNumber(p.currentPrice) ? p.currentPrice : undefined;
  const cb = isNumber(p.costBasisPerUnit) ? p.costBasisPerUnit : 0;

  // Treat qty=1 as "balance container".
  // If currentPrice is set and not ~1, interpret it as the current balance (Style A).
  if (qty === 1 && typeof cp === "number" && Number.isFinite(cp) && Math.abs(cp - 1) > 1e-9) {
    return cp;
  }

  // Style B: balance stored in costBasisPerUnit (qty=1, currentPrice≈1 or missing)
  if (qty === 1) {
    return cb > 0 ? cb : 0;
  }

  // Style C: balance stored in quantity (currentPrice≈1 or missing)
  if (cp === undefined || Math.abs(cp - 1) < 1e-9) {
    return qty > 0 ? qty : 0;
  }

  // Rare case: if a real price exists, fall back to qty * price
  return qty * cp;
}

function normalizeLoadedState(raw: unknown): PortfolioState | null {
  if (!isRecord(raw)) return null;

  const profile = (raw["profile"] as PortfolioState["profile"]) ?? null;
  const positions = Array.isArray(raw["positions"]) ? (raw["positions"] as Position[]) : [];
  const snapshots = Array.isArray(raw["snapshots"]) ? (raw["snapshots"] as PortfolioSnapshot[]) : [];
  const lastUpdated = isString(raw["lastUpdated"]) ? raw["lastUpdated"] : undefined;

  // Backwards compatible: transactions may not exist in older localStorage
  const transactions = Array.isArray(raw["transactions"])
    ? (raw["transactions"] as PortfolioState["transactions"])
    : [];

  return {
    profile,
    positions,
    transactions,
    snapshots,
    lastUpdated,
  };
}

export function loadState(): PortfolioState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = safeParse<unknown>(raw);
  return normalizeLoadedState(parsed);
}

export function saveState(state: PortfolioState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getInitialState(): PortfolioState {
  return {
    profile: null,
    positions: [],
    transactions: [],
    snapshots: [],
    lastUpdated: undefined,
  };
}

/**
 * Compute the current value of a position.
 * - Non-cash-like: value = quantity * (currentPrice ?? costBasisPerUnit)
 * - Cash-like (Money Market / Cash): value = current balance (robust)
 */
export function valueForPosition(p: Position): number {
  if (isCashLikePosition(p)) return cashLikeValue(p);

  const qty = Number(p.quantity) || 0;

  const unit =
    isNumber(p.currentPrice)
      ? p.currentPrice
      : isNumber(p.costBasisPerUnit)
        ? p.costBasisPerUnit
        : 0;

  return qty * (Number.isFinite(unit) ? unit : 0);
}

export function computeSnapshot(state: PortfolioState): PortfolioSnapshot {
  const now = new Date().toISOString();

  const byAssetClass = {} as Record<AssetClass, number>;
  const byAccountType = {} as Record<AccountType, number>;

  let totalValue = 0;

  // Gain/Loss should be computed ONLY for non-cash-like holdings.
  // Money Market / Cash is treated as "balance", not an investment with unrealized P/L.
  let investedValue = 0;
  let investedCost = 0;

  for (const pos of state.positions) {
    const value = valueForPosition(pos);
    totalValue += value;

    byAssetClass[pos.assetClass] = (byAssetClass[pos.assetClass] ?? 0) + value;
    byAccountType[pos.accountType] = (byAccountType[pos.accountType] ?? 0) + value;

    if (isCashLikePosition(pos)) {
      continue; // exclude from gain/loss math
    }

    const qty = Number(pos.quantity) || 0;
    const costPerUnit = Number(pos.costBasisPerUnit) || 0;

    investedValue += value;
    investedCost += costPerUnit * qty;
  }

  const totalGainLossDollar = investedValue - investedCost;
  const totalGainLossPercent = investedCost > 0 ? (totalGainLossDollar / investedCost) * 100 : 0;

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
