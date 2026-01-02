// lib/performance.ts
import type { Transaction } from "@/lib/types";

export type CashFlow = { date: string; amount: number }; // +inflow to investor, -outflow from investor
export type ValuePoint = { date: string; value: number };

function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO + "T00:00:00Z").getTime();
  const b = new Date(bISO + "T00:00:00Z").getTime();
  return (b - a) / (1000 * 60 * 60 * 24);
}

function safe(n: number) {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build external cash flows from transactions.
 * Convention (investor perspective):
 * - CASH_DEPOSIT: investor puts money in => negative cash flow (out of pocket)
 * - CASH_WITHDRAWAL: investor takes money out => positive cash flow (to pocket)
 *
 * Trades (BUY/SELL) are internal by default. If includeTrades=true and price is present:
 * - BUY: negative (cash out of pocket)
 * - SELL: positive (cash to pocket)
 */
export function cashFlowsFromTransactions(
  txs: Transaction[],
  opts?: { includeTrades?: boolean },
): CashFlow[] {
  const includeTrades = !!opts?.includeTrades;
  const flows: CashFlow[] = [];

  for (const t of txs) {
    if (!t?.date) continue;

    if (t.type === "CASH_DEPOSIT") {
      const amt = safe(t.amount ?? 0);
      if (amt !== 0) flows.push({ date: t.date, amount: -Math.abs(amt) });
      continue;
    }

    if (t.type === "CASH_WITHDRAWAL") {
      const amt = safe(t.amount ?? 0);
      if (amt !== 0) flows.push({ date: t.date, amount: Math.abs(amt) });
      continue;
    }

    if (includeTrades && (t.type === "BUY" || t.type === "SELL")) {
      const qty = safe(t.quantity ?? 0);
      const px = safe(t.price ?? 0);
      // only count if we can compute a notional
      if (qty > 0 && px > 0) {
        const notion = qty * px;
        flows.push({ date: t.date, amount: t.type === "BUY" ? -Math.abs(notion) : Math.abs(notion) });
      }
    }
  }

  // Combine same-day flows
  const byDate = new Map<string, number>();
  for (const f of flows) byDate.set(f.date, (byDate.get(f.date) ?? 0) + f.amount);

  return Array.from(byDate.entries())
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * XIRR (money-weighted return)
 * Returns annualized rate (0.12 => 12%).
 * Requires at least one negative and one positive cash flow.
 */
export function xirr(cashFlows: CashFlow[], guess = 0.1): number | null {
  if (cashFlows.length < 2) return null;

  const hasNeg = cashFlows.some((f) => f.amount < 0);
  const hasPos = cashFlows.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const flows = cashFlows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const t0 = flows[0].date;

  // NPV(rate) = sum( cf / (1+rate)^(days/365) )
  function npv(rate: number) {
    if (rate <= -0.999999) return Number.POSITIVE_INFINITY;
    let s = 0;
    for (const cf of flows) {
      const d = daysBetween(t0, cf.date) / 365;
      s += cf.amount / Math.pow(1 + rate, d);
    }
    return s;
  }

  function dNpv(rate: number) {
    if (rate <= -0.999999) return Number.POSITIVE_INFINITY;
    let s = 0;
    for (const cf of flows) {
      const d = daysBetween(t0, cf.date) / 365;
      if (d === 0) continue;
      s += (-d * cf.amount) / Math.pow(1 + rate, d + 1);
    }
    return s;
  }

  // 1) Newton’s method
  let r = guess;
  for (let i = 0; i < 50; i++) {
    const f = npv(r);
    const df = dNpv(r);

    if (!Number.isFinite(f) || !Number.isFinite(df) || df === 0) break;

    const next = r - f / df;

    if (Math.abs(next - r) < 1e-7) return next;

    r = Math.max(-0.95, Math.min(next, 10));
  }

  // 2) Bisection fallback (more robust)
  // Find bracket [lo, hi] such that npv(lo) and npv(hi) have opposite signs
  let lo = -0.95;
  let hi = 10;
  let fLo = npv(lo);
  let fHi = npv(hi);

  // If no sign change, try widening hi a bit
  if (Number.isFinite(fLo) && Number.isFinite(fHi) && fLo * fHi > 0) {
    hi = 50;
    fHi = npv(hi);
  }

  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) {
    return null;
  }

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (!Number.isFinite(fMid)) return null;

    if (Math.abs(fMid) < 1e-10) return mid;

    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }

    if (Math.abs(hi - lo) < 1e-7) return (hi + lo) / 2;
  }

  return (hi + lo) / 2;
}

/**
 * Time-Weighted Return (TWR) from valuation series and external flows.
 * Returns cumulative TWR for the series (0.25 => +25%).
 *
 * Per day:
 * r_t = (V_t - CF_t)/V_{t-1} - 1
 * where CF_t is net external flow ADDED TO portfolio on day t.
 *
 * Our flows are investor-perspective:
 * deposits are negative, withdrawals positive, so we invert sign for portfolio CF.
 */
export function twr(series: ValuePoint[], cashFlows: CashFlow[]): number | null {
  if (series.length < 2) return null;

  const s = series.slice().sort((a, b) => a.date.localeCompare(b.date));

  const flowByDate = new Map<string, number>();
  for (const f of cashFlows) flowByDate.set(f.date, (flowByDate.get(f.date) ?? 0) + f.amount);

  let growth = 1;

  for (let i = 1; i < s.length; i++) {
    const prev = safe(s[i - 1].value);
    const cur = safe(s[i].value);
    if (prev <= 0) continue;

    const cfInvestor = safe(flowByDate.get(s[i].date) ?? 0);
    const cfToPortfolio = -cfInvestor; // invert sign (investor -> portfolio)

    const r = (cur - cfToPortfolio) / prev - 1;
    growth *= 1 + r;
  }

  return growth - 1;
}

/**
 * Helper to build cash flows for XIRR:
 * (external flows + terminal value at end date)
 */
export function xirrCashFlowsWithTerminalValue(
  cashFlows: CashFlow[],
  terminalDate: string,
  terminalValue: number,
): CashFlow[] {
  const flows = cashFlows.slice();
  flows.push({ date: terminalDate, amount: safe(terminalValue) });
  flows.sort((a, b) => a.date.localeCompare(b.date));
  return flows;
}
