"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { usePortfolioState } from "@/lib/usePortfolioState";
import type { Transaction, TxType, AccountType, Position, AssetClass } from "@/lib/types";
import { fmtMoney } from "@/lib/format";
import { valueForPosition } from "@/lib/portfolioStorage";

const TX_TYPES: { value: TxType; label: string }[] = [
  { value: "BUY", label: "Buy" },
  { value: "SELL", label: "Sell" },
  { value: "CASH_DEPOSIT", label: "Cash deposit" },
  { value: "CASH_WITHDRAWAL", label: "Cash withdrawal" },
];

const ACCOUNTS: AccountType[] = ["Taxable", "Roth IRA", "Traditional IRA", "401k/403b", "HSA", "Other"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isTrade(t: TxType) {
  return t === "BUY" || t === "SELL";
}
function isCashFlow(t: TxType) {
  return t === "CASH_DEPOSIT" || t === "CASH_WITHDRAWAL";
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isCashLikePosition(p: Position): boolean {
  return p.assetClass === "Money Market" || p.assetClass === "Cash";
}

function keyFor(p: Pick<Position, "accountType" | "ticker">) {
  return `${(p.accountType || "Taxable")}::${(p.ticker || "").toUpperCase().trim()}`;
}

function txKey(acct: AccountType, ticker: string) {
  return `${acct}::${ticker.toUpperCase().trim()}`;
}

/**
 * Rebuild positions from transactions (Model A, incremental):
 * - Seed holdings remain the baseline
 * - Trades adjust both: holdings AND cash (BUY consumes cash, SELL adds cash)
 * - Cash flows adjust cash
 *
 * ✅ Keep all existing positions NOT affected by traded keys
 * ✅ Replace only positions for (accountType,ticker) pairs that appear in trades,
 *    but *start from the existing seed qty/cost* so we don’t wipe prior holdings.
 * ✅ Apply deposits/withdrawals + trade notionals to cash/MM per account
 */
function rebuildPositionsFromTransactions(seedPositions: Position[], txs: Transaction[]): Position[] {
  // Map seed positions by (account,ticker)
  const seedByKey = new Map<string, Position>();
  for (const p of seedPositions ?? []) {
    const k = keyFor(p);
    if (!seedByKey.has(k)) seedByKey.set(k, p);
  }

  type Agg = {
    accountType: AccountType;
    ticker: string;
    qty: number;
    cost: number; // avg cost per unit
    earliestDate?: string;
    didInitFromSeed?: boolean;
  };

  const agg = new Map<string, Agg>();
  const tradeKeys = new Set<string>();

  // Cash deltas by account (includes explicit cash flows AND trade notionals)
  const cashDeltaByAcct = new Map<AccountType, { delta: number; earliest?: string }>();

  const ordered = (txs ?? [])
    .slice()
    .filter((t) => t && t.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Helper: accumulate cash delta
  function bumpCash(acct: AccountType, delta: number, date?: string) {
    if (!Number.isFinite(delta) || delta === 0) return;
    const cur = cashDeltaByAcct.get(acct) ?? { delta: 0, earliest: undefined as string | undefined };
    cur.delta += delta;
    if (date) {
      if (!cur.earliest || date < cur.earliest) cur.earliest = date;
    }
    cashDeltaByAcct.set(acct, cur);
  }

  // Helper: get/initialize Agg for a traded key, seeded from existing holdings
  function getAgg(acct: AccountType, ticker: string, date?: string): Agg {
    const k = txKey(acct, ticker);
    const existing = agg.get(k);
    if (existing) {
      if (date && (!existing.earliestDate || date < existing.earliestDate)) existing.earliestDate = date;
      return existing;
    }

    const seed = seedByKey.get(k);
    const seededQty = seed?.quantity ?? 0;
    const seededCost = seed?.costBasisPerUnit ?? 0;

    const a: Agg = {
      accountType: acct,
      ticker: ticker.toUpperCase().trim(),
      qty: Number.isFinite(seededQty) ? seededQty : 0,
      cost: Number.isFinite(seededCost) ? seededCost : 0,
      earliestDate: date,
      didInitFromSeed: !!seed,
    };

    agg.set(k, a);
    return a;
  }

  // Helper: determine a trade price to use for notional/cost updates
  function tradePriceToUse(acct: AccountType, ticker: string, rawPx: unknown): number | null {
    const px = Number(rawPx);
    if (Number.isFinite(px) && px > 0) return px;

    const seed = seedByKey.get(txKey(acct, ticker));
    const seedPxCandidates = [seed?.currentPrice, seed?.costBasisPerUnit].map((v) => Number(v));
    for (const c of seedPxCandidates) {
      if (Number.isFinite(c) && c > 0) return c;
    }

    return null;
  }

  for (const t of ordered) {
    if (!t) continue;
    const acct: AccountType = (t.accountType ?? "Taxable") as AccountType;

    // --- CASH FLOWS ---
    if (isCashFlow(t.type)) {
      const amt = Math.abs(Number(t.amount ?? 0));
      if (!Number.isFinite(amt) || amt <= 0) continue;

      const sign = t.type === "CASH_WITHDRAWAL" ? -1 : 1;
      bumpCash(acct, sign * amt, t.date);
      continue;
    }

    // --- TRADES ---
    if (!isTrade(t.type)) continue;

    const ticker = (t.ticker ?? "").toUpperCase().trim();
    const qty = Number(t.quantity ?? 0);
    if (!ticker || !Number.isFinite(qty) || qty <= 0) continue;

    const k = txKey(acct, ticker);
    tradeKeys.add(k);

    const cur = getAgg(acct, ticker, t.date);

    const pxToUse = tradePriceToUse(acct, ticker, t.price);

    if (t.type === "BUY") {
      // Update holdings
      if (pxToUse == null) continue; // cannot compute cost/notional reliably
      const oldQty = cur.qty;
      const oldCost = cur.cost;

      const newQty = oldQty + qty;
      const newCost = newQty > 0 ? (oldQty * oldCost + qty * pxToUse) / newQty : pxToUse;

      cur.qty = newQty;
      cur.cost = newCost;
      agg.set(k, cur);

      // Model A cash impact: BUY consumes cash
      bumpCash(acct, -(qty * pxToUse), t.date);
    }

    if (t.type === "SELL") {
      // For SELL, we still want cash impact even if price missing; use fallback
      if (pxToUse == null) continue;

      cur.qty = Math.max(0, cur.qty - qty);
      agg.set(k, cur);

      // Model A cash impact: SELL adds cash
      bumpCash(acct, +(qty * pxToUse), t.date);
    }
  }

  // Build updated positions for traded keys (preserving seed metadata)
  const rebuiltTrades: Position[] = [];
  for (const [k, a] of agg.entries()) {
    // If qty ends at 0, we drop the position (like fully sold)
    if (!Number.isFinite(a.qty) || a.qty <= 0) continue;

    const seed = seedByKey.get(k);
    const assetClass: AssetClass = (seed?.assetClass ?? "Equity") as AssetClass;

    rebuiltTrades.push({
      id: seed?.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : k),
      ticker: a.ticker,
      name: seed?.name ?? a.ticker,
      assetClass,
      accountType: a.accountType,
      quantity: Number(a.qty.toFixed(8)),
      costBasisPerUnit: Number(a.cost.toFixed(6)),
      currentPrice: seed?.currentPrice,
      currency: seed?.currency ?? "USD",
      sector: seed?.sector,
      purchaseDate: seed?.purchaseDate ?? a.earliestDate,
      createdAt: seed?.createdAt ?? new Date().toISOString(),
    });
  }

  // ✅ Keep all seed positions NOT touched by trades
  // BUT: if we are applying cash deltas, we’ll replace the cash/MM position for those accounts
  const kept = (seedPositions ?? []).filter((p) => {
    const k = keyFor(p);
    if (tradeKeys.has(k)) return false;

    const acct: AccountType = (p.accountType ?? "Taxable") as AccountType;
    if (cashDeltaByAcct.has(acct) && isCashLikePosition(p)) return false;

    return true;
  });

  // Apply cash deltas -> update or create a cash-like position per affected account
  const rebuiltCash: Position[] = [];
  for (const [acct, meta] of cashDeltaByAcct.entries()) {
    const delta = meta.delta;

    // Find an existing cash-like position for this account (prefer Money Market)
    const existing =
      (seedPositions ?? []).find((p) => (p.accountType ?? "Taxable") === acct && p.assetClass === "Money Market") ??
      (seedPositions ?? []).find((p) => (p.accountType ?? "Taxable") === acct && p.assetClass === "Cash") ??
      null;

    const starting = existing ? valueForPosition(existing) : 0;

    // In Model A we allow cash to go negative if you buy without deposits (margin/overdraft).
    // If you want to clamp at 0, change this to Math.max(0, starting + delta).
    const nextBalance = starting + delta;

    if (existing) {
      rebuiltCash.push({
        ...existing,
        quantity: 1,
        costBasisPerUnit: Number(nextBalance.toFixed(2)),
        currentPrice: 1,
        purchaseDate: existing.purchaseDate ?? meta.earliest,
      });
    } else {
      rebuiltCash.push({
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${acct}::CASH`,
        ticker: "CASH",
        name: "Cash",
        assetClass: "Cash" as AssetClass,
        accountType: acct,
        quantity: 1,
        costBasisPerUnit: Number(nextBalance.toFixed(2)),
        currentPrice: 1,
        currency: "USD",
        sector: undefined,
        purchaseDate: meta.earliest,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const out = [...kept, ...rebuiltTrades, ...rebuiltCash];
  out.sort((p1, p2) => (p1.accountType + p1.ticker).localeCompare(p2.accountType + p2.ticker));
  return out;
}

export default function TransactionsTab() {
  const { state, setTransactions, setPositions, refreshPrices } = usePortfolioState();
  const [open, setOpen] = useState(false);

  const [type, setType] = useState<TxType>("BUY");
  const [date, setDate] = useState(todayISO());
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("Taxable");

  const rows = useMemo(() => {
    return (state.transactions ?? []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [state.transactions]);

  // Summary
  const summary = useMemo(() => {
    let deposits = 0;
    let withdrawals = 0;
    let buyNotional = 0;
    let sellNotional = 0;

    for (const t of state.transactions ?? []) {
      if (t.type === "CASH_DEPOSIT") deposits += Math.abs(Number(t.amount || 0));
      if (t.type === "CASH_WITHDRAWAL") withdrawals += Math.abs(Number(t.amount || 0));

      const q = Number(t.quantity ?? 0);
      const px = Number(t.price ?? NaN);

      if (t.type === "BUY" && Number.isFinite(px) && Number.isFinite(q)) buyNotional += px * q;
      if (t.type === "SELL" && Number.isFinite(px) && Number.isFinite(q)) sellNotional += px * q;
    }

    return {
      deposits,
      withdrawals,
      net: deposits - withdrawals,
      buyNotional,
      sellNotional,
    };
  }, [state.transactions]);

  function resetForm() {
    setType("BUY");
    setDate(todayISO());
    setTicker("");
    setQuantity("");
    setPrice("");
    setAmount("");
    setAccountType("Taxable");
  }

  async function syncAfterTx(nextTxs: Transaction[]) {
    const nextPositions = rebuildPositionsFromTransactions(state.positions ?? [], nextTxs);
    setPositions(nextPositions);
    await refreshPrices(nextPositions);
  }

  async function addTx() {
    if (!date) return;

    const tx: Transaction = { id: makeId(), type, date, accountType };

    if (isTrade(type)) {
      const qty = Number(quantity);
      const px = price ? Number(price) : undefined;

      if (!ticker || !Number.isFinite(qty) || qty <= 0) return;
      if (px !== undefined && (!Number.isFinite(px) || px <= 0)) return;

      tx.ticker = ticker.trim().toUpperCase();
      tx.quantity = qty;
      tx.price = px;
    } else {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) return;
      tx.amount = amt;
    }

    const nextTxs = [tx, ...(state.transactions ?? [])];
    setTransactions(nextTxs);
    await syncAfterTx(nextTxs);

    resetForm();
    setOpen(false);
  }

  async function removeTx(id: string) {
    const nextTxs = (state.transactions ?? []).filter((t) => t.id !== id);
    setTransactions(nextTxs);
    await syncAfterTx(nextTxs);
  }

  function describeTx(t: Transaction) {
    if (isTrade(t.type)) {
      const notional =
        typeof t.price === "number" && typeof t.quantity === "number" ? t.price * t.quantity : null;

      return `${t.type === "BUY" ? "Buy" : "Sell"} ${t.quantity}${
        t.price ? ` @ ${fmtMoney(t.price)}` : ""
      }${notional ? ` • ${fmtMoney(notional)}` : ""}`;
    }

    return t.type === "CASH_DEPOSIT" ? `+ ${fmtMoney(Number(t.amount))}` : `- ${fmtMoney(Number(t.amount))}`;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Transactions</CardTitle>
          <Button onClick={() => setOpen(true)}>Add transaction</Button>
        </CardHeader>

        <CardContent className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-sm">
          <div className="border rounded p-3">
            <div className="text-gray-500">Deposits</div>
            <div className="font-semibold">{fmtMoney(summary.deposits)}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-gray-500">Withdrawals</div>
            <div className="font-semibold">{fmtMoney(summary.withdrawals)}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-gray-500">Net flow</div>
            <div className="font-semibold">{fmtMoney(summary.net)}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-gray-500">Buys</div>
            <div className="font-semibold">{fmtMoney(summary.buyNotional)}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-gray-500">Sells</div>
            <div className="font-semibold">{fmtMoney(summary.sellNotional)}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-600">No transactions yet. Add deposits, withdrawals, and trades.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-gray-500 border-b">
                <tr>
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-left">Account</th>
                  <th className="py-2 text-left">Details</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2">{t.date}</td>
                    <td className="py-2">{t.accountType ?? "Taxable"}</td>
                    <td className="py-2">
                      <div className="font-medium">{isTrade(t.type) ? t.ticker : "Cash"}</div>
                      <div className="text-gray-600">{describeTx(t)}</div>
                    </td>
                    <td className="py-2 text-right">
                      <Button variant="secondary" onClick={() => removeTx(t.id)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {open && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogHeader>
            <DialogTitle>Add transaction</DialogTitle>
          </DialogHeader>

          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select value={type} onChange={(e) => setType(e.target.value as TxType)}>
              {TX_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>

            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />

            <Select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}>
              {ACCOUNTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>

            {isTrade(type) ? (
              <>
                <Input placeholder="Ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} />
                <Input placeholder="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                <Input placeholder="Price (optional)" value={price} onChange={(e) => setPrice(e.target.value)} />
              </>
            ) : (
              <Input
                className="sm:col-span-2"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addTx}>Add</Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}
