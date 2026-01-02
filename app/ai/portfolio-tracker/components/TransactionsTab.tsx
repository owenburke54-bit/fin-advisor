"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { usePortfolioState } from "@/lib/usePortfolioState";
import type { AccountType, Transaction, TxType } from "@/lib/types";
import { fmtMoney } from "@/lib/format";

const TX_TYPES: { value: TxType; label: string; hint: string }[] = [
  { value: "CASH_DEPOSIT", label: "Cash Deposit", hint: "Adds money to the portfolio (contribution)" },
  { value: "CASH_WITHDRAWAL", label: "Cash Withdrawal", hint: "Removes money from the portfolio" },
];

const ACCOUNT_TYPES: AccountType[] = ["Taxable", "Roth IRA", "Traditional IRA", "401k/403b", "HSA", "Other"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function TransactionsTab() {
  const { state, setTransactions } = usePortfolioState();

  const [type, setType] = useState<TxType>("CASH_DEPOSIT");
  const [date, setDate] = useState<string>(todayISO());
  const [amount, setAmount] = useState<string>(""); // keep as string for input UX
  const [accountType, setAccountType] = useState<AccountType>("Taxable");
  const [note, setNote] = useState<string>("");

  const txs = state.transactions ?? [];

  const sorted = useMemo(() => {
    return txs.slice().sort((a, b) => b.date.localeCompare(a.date));
  }, [txs]);

  const totals = useMemo(() => {
    let deposits = 0;
    let withdrawals = 0;

    for (const t of txs) {
      const amt = Number(t.amount ?? 0);
      if (!Number.isFinite(amt)) continue;

      if (t.type === "CASH_DEPOSIT") deposits += Math.abs(amt);
      if (t.type === "CASH_WITHDRAWAL") withdrawals += Math.abs(amt);
    }

    return { deposits, withdrawals, net: deposits - withdrawals };
  }, [txs]);

  function addTx() {
    const amt = Number(amount);
    if (!date) return;
    if (!Number.isFinite(amt) || amt <= 0) return;

    const tx: Transaction = {
      id: crypto.randomUUID(),
      type,
      date,
      amount: Math.abs(amt),
      accountType,
      // optional fields unused for cash flows
    };

    // store note by piggybacking in ticker field? no—better: ignore for now (clean)
    // if you want notes later, we’ll add a `note?: string` to Transaction type.

    setTransactions([tx, ...txs]);
    setAmount("");
    setNote("");
  }

  function removeTx(id: string) {
    setTransactions(txs.filter((t) => t.id !== id));
  }

  const typeMeta = TX_TYPES.find((t) => t.value === type);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm bg-white"
                value={type}
                onChange={(e) => setType(e.target.value as TxType)}
              >
                {TX_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {typeMeta?.hint ? <div className="mt-1 text-xs text-gray-500">{typeMeta.hint}</div> : null}
            </div>

            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
              <input
                inputMode="decimal"
                placeholder="e.g. 500"
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="mt-1 text-xs text-gray-500">Positive number (we handle sign automatically)</div>
            </div>

            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm bg-white"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as AccountType)}
              >
                {ACCOUNT_TYPES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-1 flex items-end">
              <Button className="w-full" onClick={addTx} disabled={!date || Number(amount) <= 0 || !Number.isFinite(Number(amount))}>
                Add Transaction
              </Button>
            </div>
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border bg-white p-3">
              <div className="text-xs text-gray-500">Total Deposits</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{fmtMoney(totals.deposits, 0)}</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="text-xs text-gray-500">Total Withdrawals</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{fmtMoney(totals.withdrawals, 0)}</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="text-xs text-gray-500">Net Contributions</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{fmtMoney(totals.net, 0)}</div>
            </div>
          </div>

          {/* List */}
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-12 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
              <div className="col-span-3">Date</div>
              <div className="col-span-3">Type</div>
              <div className="col-span-3">Account</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-1" />
            </div>

            {sorted.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-600">No transactions yet. Add a deposit/withdrawal above.</div>
            ) : (
              <div className="divide-y">
                {sorted.map((t) => (
                  <div key={t.id} className="grid grid-cols-12 px-3 py-2 text-sm items-center">
                    <div className="col-span-3 text-gray-800">{t.date}</div>
                    <div className="col-span-3 text-gray-800">
                      {t.type === "CASH_DEPOSIT" ? "Deposit" : t.type === "CASH_WITHDRAWAL" ? "Withdrawal" : t.type}
                    </div>
                    <div className="col-span-3 text-gray-700">{t.accountType ?? "Taxable"}</div>
                    <div className="col-span-2 text-right font-medium text-gray-900">{fmtMoney(Number(t.amount ?? 0), 0)}</div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => removeTx(t.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-gray-500">
            Tip: Deposits/withdrawals will power more accurate performance metrics (TWR / IRR) once we hook them into the chart.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
