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

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Rebuild positions from transaction history (source of truth).
 * - Aggregates by (accountType, ticker)
 * - BUY increases qty, updates weighted avg cost basis
 * - SELL decreases qty, keeps cost basis (no realized P/L tracking yet)
 * - Keeps metadata from existing positions when possible (assetClass/name/sector/currentPrice/purchaseDate)
 */
function rebuildPositionsFromTransactions(seedPositions: Position[], txs: Transaction[]): Position[] {
  const seedByKey = new Map<string, Position>();
  for (const p of seedPositions ?? []) {
    const key = `${p.accountType || "Taxable"}::${(p.ticker || "").toUpperCase().trim()}`;
    if (!seedByKey.has(key)) seedByKey.set(key, p);
  }

  type Agg = {
    accountType: AccountType;
    ticker: string;
    qty: number;
    cost: number; // weighted avg
    earliestDate?: string;
  };

  const agg = new Map<string, Agg>();

  // process in chronological order for correct avg cost / earliest date
  const ordered = (txs ?? [])
    .slice()
    .filter((t) => t && t.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const t of ordered) {
    if (!t || !isTrade(t.type)) continue;

    const ticker = (t.ticker ?? "").toUpperCase().trim();
    const acct: AccountType = (t.accountType ?? "Taxable") as AccountType;

    const qty = Number(t.quantity ?? 0);
    if (!ticker || !Number.isFinite(qty) || qty <= 0) continue;

    const key = `${acct}::${ticker}`;
    const cur = agg.get(key) ?? { accountType: acct, ticker, qty: 0, cost: 0, earliestDate: undefined };

    if (!cur.earliestDate || t.date < cur.earliestDate) cur.earliestDate = t.date;

    if (t.type === "BUY") {
      const px = Number(t.price ?? NaN);

      // If no price, fallback to seed cost basis if we have it; otherwise ignore this BUY
      const fallbackSeed = seedByKey.get(key);
      const pxToUse =
        Number.isFinite(px) && px > 0
          ? px
          : typeof fallbackSeed?.costBasisPerUnit === "number" && Number.isFinite(fallbackSeed.costBasisPerUnit)
            ? fallbackSeed.costBasisPerUnit
            : NaN;

      if (!Number.isFinite(pxToUse) || pxToUse <= 0) continue;

      const oldQty = cur.qty;
      const oldCost = cur.cost;

      const newQty = oldQty + qty;
      const newCost = newQty > 0 ? (oldQty * oldCost + qty * pxToUse) / newQty : pxToUse;

      cur.qty = newQty;
      cur.cost = newCost;
      agg.set(key, cur);
    }

    if (t.type === "SELL") {
      cur.qty = Math.max(0, cur.qty - qty);
      // cost stays the same for now
      agg.set(key, cur);
    }
  }

  const out: Position[] = [];

  for (const [key, a] of agg.entries()) {
    if (a.qty <= 0) continue;

    const seed = seedByKey.get(key);
    const assetClass: AssetClass = (seed?.assetClass ?? "Equity") as AssetClass;

    out.push({
      id: seed?.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : key),
      ticker: a.ticker,
      name: seed?.name ?? a.ticker,
      assetClass,
      accountType: a.accountType,
      quantity: Number(a.qty.toFixed(8)),
      costBasisPerUnit: Number(a.cost.toFixed(6)),
      currentPrice: seed?.currentPrice,
      currency: "USD",
      sector: seed?.sector,
      purchaseDate: seed?.purchaseDate ?? a.earliestDate,
      createdAt: seed?.createdAt ?? new Date().toISOString(),
    });
  }

  out.sort((p1, p2) => (p1.accountType + p1.ticker).localeCompare(p2.accountType + p2.ticker));
  return out;
}

export default function TransactionsTab() {
  // ✅ IMPORTANT: setTransactions/setPositions now support opts { snapshot?: boolean }
  // We snapshot once (on transactions) and avoid double-snapshotting on positions.
  const { state, setTransactions, setPositions } = usePortfolioState();
  const [open, setOpen] = useState(false);

  // form state
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

  const summary = useMemo(() => {
    let deposits = 0;
    let withdrawals = 0;

    for (const t of state.transactions ?? []) {
      if (t.type === "CASH_DEPOSIT") deposits += Number(t.amount || 0);
      if (t.type === "CASH_WITHDRAWAL") withdrawals += Number(t.amount || 0);
    }

    return { deposits, withdrawals, net: deposits - withdrawals };
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

  function addTx() {
    if (!date) return;

    const tx: Transaction = {
      id: makeId(),
      type,
      date,
      accountType,
    };

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

    // ✅ snapshot ONCE (transactions)
    setTransactions(nextTxs, { snapshot: true });

    // ✅ rebuild positions so every tab updates immediately, but DON'T snapshot again
    const nextPositions = rebuildPositionsFromTransactions(state.positions ?? [], nextTxs);
    setPositions(nextPositions, { snapshot: false });

    resetForm();
    setOpen(false);
  }

  function removeTx(id: string) {
    const nextTxs = (state.transactions ?? []).filter((t) => t.id !== id);

    // ✅ snapshot ONCE (transactions)
    setTransactions(nextTxs, { snapshot: true });

    // ✅ rebuild after delete too (no snapshot)
    const nextPositions = rebuildPositionsFromTransactions(state.positions ?? [], nextTxs);
    setPositions(nextPositions, { snapshot: false });
  }

  function describeTx(t: Transaction) {
    if (isTrade(t.type)) {
      const notional = t.price && t.quantity ? t.price * t.quantity : null;

      return `${t.type === "BUY" ? "Buy" : "Sell"} ${t.quantity}${
        t.price ? ` @ ${fmtMoney(t.price, 2)}` : ""
      }${notional ? ` • ${fmtMoney(notional, 2)}` : ""}`;
    }

    return t.type === "CASH_DEPOSIT"
      ? `+ ${fmtMoney(Number(t.amount), 2)}`
      : `- ${fmtMoney(Number(t.amount), 2)}`;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Transactions</CardTitle>
          <Button onClick={() => setOpen(true)}>Add transaction</Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="border rounded p-3">
            <div className="text-gray-500">Deposits</div>
            <div className="font-semibold">{fmtMoney(summary.deposits, 2)}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-gray-500">Withdrawals</div>
            <div className="font-semibold">{fmtMoney(summary.withdrawals, 2)}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-gray-500">Net flow</div>
            <div className="font-semibold">{fmtMoney(summary.net, 2)}</div>
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
