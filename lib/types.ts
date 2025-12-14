export type AssetClass =
  | "Equity"
  | "ETF"
  | "Mutual Fund"
  | "Crypto"
  | "Bond"
  | "Money Market"
  | "Cash"
  | "Other";

export type AccountType =
  | "Taxable"
  | "Roth IRA"
  | "Traditional IRA"
  | "401k/403b"
  | "HSA"
  | "Other";

export interface Position {
  id: string; // uuid
  ticker: string; // e.g. AAPL, VOO, BTC-USD
  name: string; // Friendly name
  assetClass: AssetClass;
  accountType: AccountType;
  quantity: number;
  costBasisPerUnit: number;
  currentPrice?: number; // fetched from market data
  currency: "USD"; // keep it simple for now
  sector?: string; // for equities/ETFs if available
  purchaseDate?: string; // YYYY-MM-DD (optional)
  createdAt: string;
}

export type RiskLevel = 1 | 2 | 3 | 4 | 5; // 1 = very conservative, 5 = very aggressive

export interface UserProfile {
  name?: string;
  age: number;
  riskLevel: RiskLevel;
  investmentHorizonYears: number; // e.g. 5, 10, 30
  portfolioStartDate?: string; // YYYY-MM-DD (optional)
  primaryGoal:
    | "Retirement"
    | "House"
    | "Wealth Building"
    | "Education"
    | "Short-Term Savings"
    | "Other";
  goalDescription?: string;
  monthlyContribution?: number; // planned contributions
}

export interface PortfolioSnapshot {
  timestamp: string;
  totalValue: number;
  totalGainLossDollar: number;
  totalGainLossPercent: number;
  byAssetClass: Record<AssetClass, number>; // value
  byAccountType: Record<AccountType, number>;
}

export interface PortfolioState {
  profile: UserProfile | null;
  positions: Position[];
  snapshots: PortfolioSnapshot[]; // historical snapshots
  lastUpdated?: string;
}

export type RiskMixKey = "equity" | "bonds" | "cash";
export type Mix = Record<RiskMixKey, number>; // percents 0..1

export function targetMixForRisk(risk: RiskLevel): Mix {
  switch (risk) {
    case 1:
      return { equity: 0.2, bonds: 0.6, cash: 0.2 };
    case 2:
      return { equity: 0.4, bonds: 0.5, cash: 0.1 };
    case 3:
      return { equity: 0.6, bonds: 0.3, cash: 0.1 };
    case 4:
      return { equity: 0.75, bonds: 0.2, cash: 0.05 };
    case 5:
      return { equity: 0.9, bonds: 0.1, cash: 0.0 };
    default:
      return { equity: 0.6, bonds: 0.3, cash: 0.1 };
  }
}

export function isEquityLike(a: AssetClass): boolean {
  return a === "Equity" || a === "ETF" || a === "Mutual Fund" || a === "Crypto";
}

export function isBondLike(a: AssetClass): boolean {
  return a === "Bond";
}

export function isCashLike(a: AssetClass): boolean {
  return a === "Cash" || a === "Money Market";
}

