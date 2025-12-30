// lib/performance.ts
import type { Transaction } from "@/lib/types";

export type CashFlow = { date: string; amount: number }; // amount: +inflow to investor, -outflow from investor
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
 * Convention:
 * - CASH_DEPOSIT: investor puts money in => negative cash flow (out of pocket)
 * - CASH_WITHDRAWAL: investor takes money out => positive cash flow (to pocket)
 *
 * BUY/SELL are INTERNAL (no external flow) unless you later model broker cash explicitly.
 */
export function cashFlowsFromTransactions(txs: Transaction[]): CashFlow[] {
  const flows: CashFlow[] = [];

  for (const t of txs) {
    if (!t?.date) continue;

    if (t.type === "CASH_DEPOSIT") {
      const amt = safe(t.amount ?? 0);
      if (amt !== 0) flows.push({ date: t.date, amount: -Math.abs(amt) });
    }

    if (t.type === "CASH_WITHDRAWAL") {
      const amt = safe(t.amount ?? 0);
      if (amt !== 0) flows.push({ date: t.date, amount: Math.abs(amt) });
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
 * XIRR (money-weighted return) using Newton's method.
 * Returns annualized rate (e.g., 0.12 => 12%).
 *
 * Requires at least one negative and one positive cash flow.
 */
export function xirr(cashFlows: CashFlow[], guess = 0.1): number | null {
  if (cashFlows.length < 2) return null;

  const hasNeg = cashFlows.some((f) => f.amount < 0);
  const hasPos = cashFlows.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const t0 = cashFlows[0].date;

  // NPV(rate) = sum( cf / (1+rate)^(days/365) )
  function npv(rate: number) {
    if (rate <= -0.999999) return Number.POSITIVE_INFINITY;
    let s = 0;
    for (const cf of cashFlows) {
      const d = daysBetween(t0, cf.date) / 365;
      s += cf.amount / Math.pow(1 + rate, d);
    }
    return s;
  }

  // derivative of NPV
  function dNpv(rate: number) {
    if (rate <= -0.999999) return Number.POSITIVE_INFINITY;
    let s = 0;
    for (const cf of cashFlows) {
      const d = daysBetween(t0, cf.date) / 365;
      if (d === 0) continue;
      s += (-d * cf.amount) / Math.pow(1 + rate, d + 1);
    }
    return s;
  }

  let r = guess;
  for (let i = 0; i < 50; i++) {
    const f = npv(r);
    const df = dNpv(r);

    if (!Number.isFinite(f) || !Number.isFinite(df) || df === 0) break;

    const next = r - f / df;

    // convergence
    if (Math.abs(next - r) < 1e-7) return next;

    // keep rate in sane bounds
    r = Math.max(-0.95, Math.min(next, 10));
  }

  // Fallback: if Newton fails, return null (we can add bisection later if needed)
  return null;
}

/**
 * Time-Weighted Return (TWR) from valuation series and external flows.
 * Returns cumulative TWR for the series (e.g., 0.25 => +25%).
 *
 * Formula per day:
 * r_t = (V_t - CF_t)/V_{t-1} - 1
 * where CF_t is net external flow on day t (deposit/withdrawal).
 */
export function twr(series: ValuePoint[], cashFlows: CashFlow[]): number | null {
  if (series.length < 2) return null;

  const flowByDate = new Map<string, number>();
  for (const f of cashFlows) flowByDate.set(f.date, (flowByDate.get(f.date) ?? 0) + f.amount);

  let growth = 1;

  for (let i = 1; i < series.length; i++) {
    const prev = safe(series[i - 1].value);
    const cur = safe(series[i].value);

    if (prev <= 0) continue;

    // cash flow on "cur" date:
    // note: our convention is deposits negative, withdrawals positive
    // In the TWR formula CF_t is external flow *added to portfolio value*.
    // Deposits increase V, so CF_t should be +deposit.
    // Because our deposit is stored negative, invert sign here.
    const cfInvestor = safe(flowByDate.get(series[i].date) ?? 0);
    const cfToPortfolio = -cfInvestor;

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
