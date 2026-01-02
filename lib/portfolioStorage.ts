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
 * Normalize date strings into YYYY-MM-DD if possible.
 * Accepts:
 * - YYYY-MM-DD (passes through)
 * - M/D/YYYY or MM/DD/YYYY (converts)
 */
function normalizeDateISO(input: unknown): string | undefined {
  if (!isString(input)) return undefined;
  const s = input.trim();
  if (!s) return undefined;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // M/D/YYYY or MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return undefined;
}

/**
 * For Money Market / Cash we treat value as "balance".
 * The app stores these in a few possible ways depending on import/UI:
 *  - Typical: quantity=1, currentPrice=1, costBasisPerUnit=balance
 *  - Alternate: quantity=balance, currentPrice≈1, costBasisPerUnit≈1
 *
 * This helper makes value calculation robust across those.
 */
function cashLikeValue(p: Position): number {
  const qty = Number(p.quantity) || 0;
  const cp = isNumber(p.currentPrice) ? p.currentPrice : undefined;
  const cb = isNumber(p.costBasisPerUnit) ? p.costBasisPerUnit : 0;

  // Style A: balance stored in costBasisPerUnit (qty=1, price=1)
  if (qty === 1 && (cp === undefined || Math.abs(cp - 1) < 1e-9)) {
    return cb > 0 ? cb : 0;
  }

  // Style B: balance stored in quantity (price≈1)
  if (cp === undefined || Math.abs(cp - 1) < 1e-9) {
    return qty > 0 ? qty : 0;
  }

  // If a real price exists (rare for MM), fall back to qty * price
  return qty * cp;
}

function normalizeLoadedState(raw: unknown): PortfolioState | null {
  if (!isRecord(raw)) return null;

  const profile = (raw["profile"] as PortfolioState["profile"]) ?? null;
  const positionsRaw = Array.isArray(raw["positions"]) ? (raw["positions"] as Position[]) : [];
  const snapshots = Array.isArray(raw["snapshots"]) ? (raw["snapshots"] as PortfolioSnapshot[]) : [];
  const lastUpdated = isString(raw["lastUpdated"]) ? raw["lastUpdated"] : undefined;

  // Backwards compatible: transactions may not exist in older localStorage
  const transactions = Array.isArray(raw["transactions"])
    ? (raw["transactions"] as PortfolioState["transactions"])
    : [];

  // ✅ Normalize purchaseDate so history logic can trust it
  const positions: Position[] = positionsRaw.map((p) => {
    const normalized = normalizeDateISO((p as any).purchaseDate);
    return {
      ...p,
      purchaseDate: normalized ?? undefined,
    };
  });

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
 * - Cash-like (Money Market / Cash): value = balance (robust across stored styles)
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

  // Gain/Loss computed ONLY for non-cash-like holdings.
  let investedValue = 0;
  let investedCost = 0;

  for (const pos of state.positions) {
    const value = valueForPosition(pos);
    totalValue += value;

    byAssetClass[pos.assetClass] = (byAssetClass[pos.assetClass] ?? 0) + value;
    byAccountType[pos.accountType] = (byAccountType[pos.accountType] ?? 0) + value;

    if (isCashLikePosition(pos)) continue;

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
