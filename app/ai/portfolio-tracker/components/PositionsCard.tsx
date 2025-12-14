"use client";

import { useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { AccountType, AssetClass, Position } from "@/lib/types";
import { valueForPosition } from "@/lib/portfolioStorage";

const positionSchema = z.object({
  ticker: z.string().min(1, "Ticker is required"),
  name: z.string().optional(),
  assetClass: z.custom<AssetClass>(),
  accountType: z.custom<AccountType>(),
  quantity: z.number().min(0, "Quantity must be >= 0"),
  costBasisPerUnit: z.number().min(0, "Cost basis must be >= 0"),
});

const ASSET_CLASSES: AssetClass[] = ["Equity", "ETF", "Mutual Fund", "Crypto", "Bond", "Money Market", "Cash", "Other"];
const ACCOUNT_TYPES: AccountType[] = ["Taxable", "Roth IRA", "Traditional IRA", "401k/403b", "HSA", "Other"];

export default function PositionsCard() {
  const {
    state,
    addPosition,
    updatePosition,
    deletePosition,
    clearPositions,
    exportCSV,
    exportJSON,
    importCSV,
    refreshPrices,
  } =
    usePortfolioState();
  const [mmEdits, setMmEdits] = useState<Record<string, number>>({});
  function handleUpdateMoneyMarketBalance(p: Position, balance: number) {
    const sanitized = Number.isFinite(balance) && balance >= 0 ? balance : 0;
    updatePosition({
      ...p,
      // Encode balance style: qty=1, price=1, value = costBasisPerUnit
      quantity: 1,
      currentPrice: 1,
      costBasisPerUnit: sanitized,
    });
    setMmEdits((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
  }
  const [form, setForm] = useState<Omit<Position, "id" | "currency" | "createdAt">>({
    ticker: "",
    name: "",
    assetClass: "Equity",
    accountType: "Taxable",
    quantity: 0,
    costBasisPerUnit: 0,
    currentPrice: undefined,
    sector: undefined,
    purchaseDate: undefined,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Position | null>(null);
  const [importText, setImportText] = useState("");
  const [importErrs, setImportErrs] = useState<string[]>([]);

  function handleAdd() {
    const parsed = positionSchema.safeParse({
      ...form,
      ticker: form.ticker.trim().toUpperCase(),
      quantity: Number(form.quantity),
      costBasisPerUnit: Number(form.costBasisPerUnit),
    });
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "form";
        e[path] = issue.message;
      }
      setErrors(e);
      return;
    }
    setErrors({});
    const now = new Date().toISOString();
    const position: Position = {
      id: crypto.randomUUID(),
      ticker: parsed.data.ticker,
      name: form.name?.trim() || form.ticker.toUpperCase(),
      assetClass: parsed.data.assetClass,
      accountType: parsed.data.accountType,
      quantity: parsed.data.quantity,
      costBasisPerUnit: parsed.data.costBasisPerUnit,
      currentPrice: undefined,
      currency: "USD",
      sector: form.sector,
      purchaseDate: form.purchaseDate,
      createdAt: now,
    };
    addPosition(position);
    // Fetch latest price for the newly added ticker
    void refreshPrices();
    setForm({
      ticker: "",
      name: "",
      assetClass: "Equity",
      accountType: "Taxable",
      quantity: 0,
      costBasisPerUnit: 0,
      currentPrice: undefined,
      sector: undefined,
      purchaseDate: undefined,
    });
  }

  function startEdit(p: Position) {
    setEditing(p);
  }
  function applyEdit() {
    if (!editing) return;
    // simple validation reuse
    const parsed = positionSchema.safeParse({
      ticker: editing.ticker,
      name: editing.name,
      assetClass: editing.assetClass,
      accountType: editing.accountType,
      quantity: Number(editing.quantity),
      costBasisPerUnit: Number(editing.costBasisPerUnit),
    });
    if (!parsed.success) return;
    updatePosition({ ...editing });
    setEditing(null);
  }

  function handleImportCSV() {
    const res = importCSV(importText);
    setImportErrs(res.errors);
    if (res.success) {
      setImportText("");
      // ensure any missing prices are populated
      void refreshPrices();
    }
  }

  const hasPositions = state.positions.length > 0;
  const totalPositions = state.positions.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Positions</CardTitle>
            <CardDescription>Add your holdings and manage them here.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => refreshPrices()}>
              Refresh Prices
            </Button>
            {hasPositions && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const blob = new Blob([exportCSV()], { type: "text/csv;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "positions.csv";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export CSV
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const blob = new Blob([exportJSON()], { type: "application/json;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "positions.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export JSON
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Add form */}
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-sm mb-1">Ticker</label>
            <Input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} />
            {errors.ticker && <p className="text-xs text-red-600 mt-1">{errors.ticker}</p>}
          </div>
          <div>
            <label className="block text-sm mb-1">Purchase date (optional)</label>
            <Input
              type="date"
              value={form.purchaseDate ?? ""}
              onChange={(e) => setForm({ ...form, purchaseDate: e.target.value || undefined })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm mb-1">Name</label>
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm mb-1">Asset class</label>
            <Select
              value={form.assetClass}
              onChange={(e) => setForm({ ...form, assetClass: e.target.value as AssetClass })}
            >
              {ASSET_CLASSES.map((ac) => (
                <option key={ac} value={ac}>
                  {ac}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-sm mb-1">Account type</label>
            <Select
              value={form.accountType}
              onChange={(e) => setForm({ ...form, accountType: e.target.value as AccountType })}
            >
              {ACCOUNT_TYPES.map((at) => (
                <option key={at} value={at}>
                  {at}
                </option>
              ))}
            </Select>
          </div>
          {(form.assetClass === "Money Market" || form.assetClass === "Cash") ? (
            <>
              <div className="sm:col-span-2">
                <label className="block text-sm mb-1">Balance ($)</label>
                <Input
                  type="number"
                  value={form.costBasisPerUnit}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      costBasisPerUnit: Number(e.target.value),
                      quantity: 1,
                      currentPrice: 1,
                    })
                  }
                />
                <p className="text-xs text-gray-600 mt-1">
                  Money market / cash uses $1 NAV. Enter your current balance.
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm mb-1">Quantity</label>
                <Input
                  type="number"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                />
                {errors.quantity && <p className="text-xs text-red-600 mt-1">{errors.quantity}</p>}
              </div>
              <div>
                <label className="block text-sm mb-1">Cost basis / unit ($)</label>
                <Input
                  type="number"
                  value={form.costBasisPerUnit}
                  onChange={(e) => setForm({ ...form, costBasisPerUnit: Number(e.target.value) })}
                />
                {errors.costBasisPerUnit && <p className="text-xs text-red-600 mt-1">{errors.costBasisPerUnit}</p>}
              </div>
            </>
          )}
          <div className="sm:col-span-6">
            <Button onClick={handleAdd}>Add Position</Button>
          </div>
        </div>

        {/* Import */}
        <div className="rounded-lg border border-dashed p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Import from CSV</p>
            <p className="text-xs text-gray-500">
              Columns: ticker, name, assetClass, accountType, quantity, costBasisPerUnit, purchaseDate, currentPrice (optional)
            </p>
          </div>
          <textarea
            className="w-full min-h-[80px] rounded border p-2 text-sm"
            placeholder="Paste CSV here"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="mt-2 flex justify-between">
            <div className="text-xs text-gray-600 self-center">
              Tip: If you import the wrong file, use “Delete all” to start fresh.
            </div>
            <Button variant="secondary" onClick={handleImportCSV}>
              Import CSV
            </Button>
            {hasPositions && (
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirm("Delete all positions? This cannot be undone.")) {
                    clearPositions();
                  }
                }}
              >
                Delete all
              </Button>
            )}
          </div>
          {importErrs.length > 0 && (
            <ul className="mt-2 list-disc pl-6 text-xs text-red-600">
              {importErrs.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">{totalPositions} positions</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="px-2 py-1">Ticker</th>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Asset</th>
                  <th className="px-2 py-1">Account</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                  <th className="px-2 py-1 text-right">Cost/Unit</th>
                  <th className="px-2 py-1 text-right">Current</th>
                  <th className="px-2 py-1 text-right">Value</th>
                  <th className="px-2 py-1 text-right">Unreal. $</th>
                  <th className="px-2 py-1 text-right">Unreal. %</th>
                  <th className="px-2 py-1 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.positions.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-2 py-4 text-center text-gray-600">
                      Add your first position (e.g., AAPL, VOO, BTCUSD).
                    </td>
                  </tr>
                ) : (
                  state.positions.map((p) => {
                    const value = valueForPosition(p);
                    const costTotal = p.costBasisPerUnit * p.quantity;
                    const plDollar = value - costTotal;
                    const plPct = costTotal > 0 ? (plDollar / costTotal) * 100 : 0;
                    const isMM = p.assetClass === "Money Market";
                    return (
                      <tr key={p.id} className="border-t">
                        <td className="px-2 py-2 font-medium">{p.ticker}</td>
                        <td className="px-2 py-2">{p.name}</td>
                        <td className="px-2 py-2">{p.assetClass}</td>
                        <td className="px-2 py-2">{p.accountType}</td>
                        <td className="px-2 py-2 text-right">{p.quantity}</td>
                        <td className="px-2 py-2 text-right">${p.costBasisPerUnit.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right">
                          {typeof p.currentPrice === "number" ? `$${p.currentPrice.toFixed(2)}` : "—"}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {isMM ? (
                            <div className="flex items-center justify-end gap-2">
                              <Input
                                type="number"
                                className="h-8 w-24 text-right"
                                value={String(
                                  mmEdits[p.id] !== undefined ? mmEdits[p.id] : Number(value.toFixed(2)),
                                )}
                                onChange={(e) =>
                                  setMmEdits((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === \"Enter\") {
                                    const v = Number(mmEdits[p.id] ?? value);
                                    handleUpdateMoneyMarketBalance(p, v);
                                  }
                                }}
                              />
                              <Button
                                size=\"sm\"
                                onClick={() => {
                                  const v = Number(mmEdits[p.id] ?? value);
                                  handleUpdateMoneyMarketBalance(p, v);
                                }}
                              >
                                Save
                              </Button>
                              <Tooltip text=\"Money market/CASH uses $1 NAV. Value equals current balance.\">
                                <span className=\"text-gray-400 cursor-help\">?</span>
                              </Tooltip>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              ${value.toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td className={`px-2 py-2 text-right ${plDollar >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {plDollar >= 0 ? "+" : ""}${plDollar.toFixed(2)}
                        </td>
                        <td className={`px-2 py-2 text-right ${plPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {plPct >= 0 ? "+" : ""}
                          {plPct.toFixed(2)}%
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => startEdit(p)}>
                              Edit
                            </Button>
                            <Button variant="destructive" onClick={() => deletePosition(p.id)}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => (!o ? setEditing(null) : null)}>
        <DialogHeader>
          <DialogTitle>Edit Position</DialogTitle>
        </DialogHeader>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">Ticker</label>
                <Input
                  value={editing.ticker}
                  onChange={(e) => setEditing({ ...editing, ticker: e.target.value.toUpperCase() })}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Name</label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm mb-1">Asset class</label>
                <Select
                  value={editing.assetClass}
                  onChange={(e) => setEditing({ ...editing, assetClass: e.target.value as AssetClass })}
                >
                  {ASSET_CLASSES.map((ac) => (
                    <option key={ac} value={ac}>
                      {ac}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-sm mb-1">Account type</label>
                <Select
                  value={editing.accountType}
                  onChange={(e) => setEditing({ ...editing, accountType: e.target.value as AccountType })}
                >
                  {ACCOUNT_TYPES.map((at) => (
                    <option key={at} value={at}>
                      {at}
                    </option>
                  ))}
                </Select>
              </div>
              {(editing.assetClass === "Money Market" || editing.assetClass === "Cash") ? (
                <>
                  <div className="sm:col-span-2">
                    <label className="block text-sm mb-1">Balance ($)</label>
                    <Input
                      type="number"
                      value={editing.costBasisPerUnit}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          costBasisPerUnit: Number(e.target.value),
                          quantity: 1,
                          currentPrice: 1,
                        })
                      }
                    />
                    <p className="text-xs text-gray-600 mt-1">Money market / cash uses $1 NAV.</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm mb-1">Quantity</label>
                    <Input
                      type="number"
                      value={editing.quantity}
                      onChange={(e) => setEditing({ ...editing, quantity: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Cost basis / unit</label>
                    <Input
                      type="number"
                      value={editing.costBasisPerUnit}
                      onChange={(e) => setEditing({ ...editing, costBasisPerUnit: Number(e.target.value) })}
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm mb-1">Purchase date</label>
                <Input
                  type="date"
                  value={editing.purchaseDate ?? ""}
                  onChange={(e) => setEditing({ ...editing, purchaseDate: e.target.value || undefined })}
                />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button onClick={applyEdit}>Save</Button>
        </DialogFooter>
      </Dialog>
    </Card>
  );
}

