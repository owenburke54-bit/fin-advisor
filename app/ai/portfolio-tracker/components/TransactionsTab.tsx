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
 * Rebuild positions from transaction history (TRADES ONLY), but:
 * ✅ Keep all existing positions that are NOT affected by trade keys
 * ✅ Only replace positions for (accountType,ticker) pairs that appear in trades
 */
function rebuildPositionsFromTransactions(seedPositions: Position[], txs: Transaction[]): Position[] {
  const seedByKey = new Map<string, Position>();
  for (const p of seedPositions ?? []) {
    const key = `${(p.accountType || "Taxable")}::${(p.ticker || "").toUpperCase().trim()}`;
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
  const tradeKeys = new Set<string>();

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
    tradeKeys.add(key);

    const cur = agg.get(key) ?? { accountType: acct, ticker, qty: 0, cost: 0, earliestDate: undefined };
    if (!cur.earliestDate || t.date < cur.earliestDate) cur.earliestDate = t.date;

    if (t.type === "BUY") {
      const px = Number(t.price ?? NaN);

      // fallback: if user left price blank, try seed cost basis
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
      agg.set(key, cur);
    }
  }

  // Build updated positions for traded keys
  const rebuilt: Position[] = [];
  for (const [key, a] of agg.entries()) {
    // if qty is now 0, we consider the position closed
    if (a.qty <= 0) continue;

    const seed = seedByKey.get(key);
    const assetClass: AssetClass = (seed?.assetClass ?? "Equity") as AssetClass;

    rebuilt.push({
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

  // ✅ Keep all seed positions NOT touched by trades
  const kept = (seedPositions ?? []).filter((p) => {
    const key = `${(p.accountType || "Taxable")}::${(p.ticker || "").toUpperCase().trim()}`;
    return !tradeKeys.has(key);
  });

  const out = [...kept, ...rebuilt];

  // deterministic ordering
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

  // ✅ Summary: show cash flows + trade notional (so this page never looks "broken")
  const summary = useMemo(() => {
    let deposits = 0;
    let withdrawals = 0;
    let buyNotional = 0;
    let sellNotional = 0;

    for (const t of state.transactions ?? []) {
      if (t.type === "CASH_DEPOSIT") deposits += Math.abs(Number(t.amount || 0));
      if (t.type === "CASH_WITHDRAWAL") withdrawals += Math.abs(Number(t.amount || 0));

      if (t.type === "BUY" && t.price && t.quantity) buyNotional += t.price * t.quantity;
      if (t.type === "SELL" && t.price && t.quantity) sellNotional += t.price * t.quantity;
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
    // ✅ rebuild without nuking the rest of the portfolio
    const nextPositions = rebuildPositionsFromTransactions(state.positions ?? [], nextTxs);
    setPositions(nextPositions);

    // ✅ refresh prices so Overview/Allocation update immediately
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
      const notional = t.price && t.quantity ? t.price * t.quantity : null;
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
