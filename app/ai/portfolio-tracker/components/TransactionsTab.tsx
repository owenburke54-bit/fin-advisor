"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { usePortfolioState } from "@/lib/usePortfolioState";
import type { Transaction, TxType, AccountType } from "@/lib/types";
import { fmtMoney } from "@/lib/format";

const TX_TYPES: { value: TxType; label: string }[] = [
  { value: "BUY", label: "Buy" },
  { value: "SELL", label: "Sell" },
  { value: "CASH_DEPOSIT", label: "Cash deposit" },
  { value: "CASH_WITHDRAWAL", label: "Cash withdrawal" },
];

const ACCOUNTS: AccountType[] = [
  "Taxable",
  "Roth IRA",
  "Traditional IRA",
  "401k/403b",
  "HSA",
  "Other",
];

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

export default function TransactionsTab() {
  const { state, setTransactions } = usePortfolioState();
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
    return (state.transactions ?? [])
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [state.transactions]);

  const summary = useMemo(() => {
    let deposits = 0;
    let withdrawals = 0;

    for (const t of state.transactions ?? []) {
      if (t.type === "CASH_DEPOSIT") deposits += Number(t.amount || 0);
      if (t.type === "CASH_WITHDRAWAL") withdrawals += Number(t.amount || 0);
    }

    return {
      deposits,
      withdrawals,
      net: deposits - withdrawals,
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

    setTransactions([tx, ...(state.transactions ?? [])]);
    resetForm();
    setOpen(false);
  }

  function removeTx(id: string) {
    setTransactions((state.transactions ?? []).filter((t) => t.id !== id));
  }

  function describeTx(t: Transaction) {
    if (isTrade(t.type)) {
      const notional =
        t.price && t.quantity ? t.price * t.quantity : null;

      return `${t.type === "BUY" ? "Buy" : "Sell"} ${
        t.quantity
      }${t.price ? ` @ ${fmtMoney(t.price, 2)}` : ""}${
        notional ? ` • ${fmtMoney(notional, 2)}` : ""
      }`;
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
            <p className="text-sm text-gray-600">
              No transactions yet. Add deposits, withdrawals, and trades.
            </p>
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
                    <td className="py-2">{t.accountType}</td>
                    <td className="py-2">
                      <div className="font-medium">
                        {isTrade(t.type) ? t.ticker : "Cash"}
                      </div>
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
