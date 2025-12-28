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

function normalizeLoadedState(raw: unknown): PortfolioState | null {
  if (!isRecord(raw)) return null;

  const profile = (raw["profile"] as PortfolioState["profile"]) ?? null;
  const positions = Array.isArray(raw["positions"]) ? (raw["positions"] as Position[]) : [];
  const snapshots = Array.isArray(raw["snapshots"]) ? (raw["snapshots"] as PortfolioSnapshot[]) : [];
  const lastUpdated = isString(raw["lastUpdated"]) ? raw["lastUpdated"] : undefined;

  // NEW: transactions (backwards compatible with older localStorage)
  const transactions = Array.isArray(raw["transactions"]) ? (raw["transactions"] as PortfolioState["transactions"]) : [];

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
    transactions: [], // <-- added
    snapshots: [],
    lastUpdated: undefined,
  };
}

/**
 * Compute the current value of a position.
 * Rules:
 *  - Value = quantity * unitPrice
 *  - unitPrice = currentPrice (if present) else costBasisPerUnit
 *  - For Money Market / Cash, if unitPrice is missing/invalid, default to 1 (typical NAV)
 */
export function valueForPosition(p: Position): number {
  const qty = Number(p.quantity) || 0;

  const rawUnit =
    isNumber(p.currentPrice)
      ? p.currentPrice
      : isNumber(p.costBasisPerUnit)
        ? p.costBasisPerUnit
        : 0;

  const isCashLike = p.assetClass === "Money Market" || p.assetClass === "Cash";

  const unitPrice = isCashLike && (rawUnit <= 0 || !Number.isFinite(rawUnit)) ? 1 : rawUnit;

  return qty * unitPrice;
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

    // Cost basis total is always costBasisPerUnit * quantity (including Money Market/Cash)
    const cost = (Number(pos.costBasisPerUnit) || 0) * (Number(pos.quantity) || 0);
    totalCost += cost;

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
    idx === -1 ? [...state.positions, position] : state.positions.map((p, i) => (i === idx ? position : p));
  const next: PortfolioState = { ...state, positions };
  return withSnapshot(next);
}

export function deletePosition(state: PortfolioState, id: string): PortfolioState {
  const positions = state.positions.filter((p) => p.id !== id);
  const next: PortfolioState = { ...state, positions };
  return withSnapshot(next);
}
