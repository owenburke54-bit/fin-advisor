"use client";

import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
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

function isCashLike(ac: AssetClass) {
  return ac === "Money Market" || ac === "Cash";
}

export default function PositionsCard() {
  const { state, addPosition, updatePosition, deletePosition, clearPositions, exportCSV, exportJSON, importCSV, refreshPrices } =
    usePortfolioState();

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

  function normalizeCashLikeFields<T extends { assetClass: AssetClass; quantity: number; costBasisPerUnit: number; currentPrice?: number }>(
    obj: T
  ): T {
    if (!isCashLike(obj.assetClass)) return obj;
    return {
      ...obj,
      // For cash-like: quantity is the balance, prices are usually 1.00
      costBasisPerUnit: Number.isFinite(obj.costBasisPerUnit) && obj.costBasisPerUnit > 0 ? obj.costBasisPerUnit : 1,
      currentPrice: typeof obj.currentPrice === "number" && Number.isFinite(obj.currentPrice) && obj.currentPrice > 0 ? obj.currentPrice : 1,
    };
  }

  function handleAdd() {
    const cashNormalized = normalizeCashLikeFields({
      ...form,
      ticker: form.ticker.trim().toUpperCase(),
      quantity: Number(form.quantity),
      costBasisPerUnit: Number(form.costBasisPerUnit),
      currentPrice: typeof form.currentPrice === "number" ? Number(form.currentPrice) : undefined,
    });

    const parsed = positionSchema.safeParse({
      ...cashNormalized,
      ticker: cashNormalized.ticker,
      quantity: cashNormalized.quantity,
      costBasisPerUnit: cashNormalized.costBasisPerUnit,
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
      name: cashNormalized.name?.trim() || parsed.data.ticker,
      assetClass: parsed.data.assetClass,
      accountType: parsed.data.accountType,
      quantity: parsed.data.quantity,
      costBasisPerUnit: parsed.data.costBasisPerUnit,
      currentPrice: cashNormalized.currentPrice,
      currency: "USD",
      sector: cashNormalized.sector,
      purchaseDate: cashNormalized.purchaseDate,
      createdAt: now,
    };

    addPosition(position);
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

    const cashNormalized = normalizeCashLikeFields({
      ...editing,
      quantity: Number(editing.quantity),
      costBasisPerUnit: Number(editing.costBasisPerUnit),
      currentPrice: typeof editing.currentPrice === "number" ? Number(editing.currentPrice) : undefined,
    });

    const parsed = positionSchema.safeParse({
      ticker: cashNormalized.ticker,
      name: cashNormalized.name,
      assetClass: cashNormalized.assetClass,
      accountType: cashNormalized.accountType,
      quantity: Number(cashNormalized.quantity),
      costBasisPerUnit: Number(cashNormalized.costBasisPerUnit),
    });

    if (!parsed.success) return;

    updatePosition({ ...cashNormalized });
    setEditing(null);
  }

  function handleImportCSV() {
    const res = importCSV(importText);
    setImportErrs(res.errors);

    if (res.success) {
      setImportText("");
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
            <Select value={form.assetClass} onChange={(e) => setForm({ ...form, assetClass: e.target.value as AssetClass })}>
              {ASSET_CLASSES.map((ac) => (
                <option key={ac} value={ac}>
                  {ac}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm mb-1">Account type</label>
            <Select value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value as AccountType })}>
              {ACCOUNT_TYPES.map((at) => (
                <option key={at} value={at}>
                  {at}
                </option>
              ))}
            </Select>
          </div>

          {isCashLike(form.assetClass) ? (
            <>
              <div>
                <label className="block text-sm mb-1">Balance ($)</label>
                <Input
                  type="number"
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      quantity: Number(e.target.value),
                      costBasisPerUnit: form.costBasisPerUnit || 1,
                      currentPrice: form.currentPrice ?? 1,
                    })
                  }
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Purchase price ($)</label>
                <Input
                  type="number"
                  value={form.costBasisPerUnit || 1}
                  onChange={(e) => setForm({ ...form, costBasisPerUnit: Number(e.target.value) })}
                />
                <p className="text-xs text-gray-600 mt-1">Usually $1.00 for money markets.</p>
              </div>

              <div>
                <label className="block text-sm mb-1">Current price ($)</label>
                <Input
                  type="number"
                  value={form.currentPrice ?? 1}
                  onChange={(e) => setForm({ ...form, currentPrice: Number(e.target.value) })}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm mb-1">Quantity</label>
                <Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
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
            <div className="text-xs text-gray-600 self-center">Tip: If you import the wrong file, use “Delete all” to start fresh.</div>

            <Button variant="secondary" onClick={handleImportCSV}>
              Import CSV
            </Button>

            {hasPositions && (
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirm("Delete all positions? This cannot be undone.")) clearPositions();
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
                        <td className="px-2 py-2 text-right">${value.toFixed(2)}</td>

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

              {isCashLike(editing.assetClass) ? (
                <>
                  <div>
                    <label className="block text-sm mb-1">Balance ($)</label>
                    <Input
                      type="number"
                      value={editing.quantity}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          quantity: Number(e.target.value),
                          costBasisPerUnit: editing.costBasisPerUnit || 1,
                          currentPrice: editing.currentPrice ?? 1,
                        })
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-sm mb-1">Purchase price ($)</label>
                    <Input
                      type="number"
                      value={editing.costBasisPerUnit || 1}
                      onChange={(e) => setEditing({ ...editing, costBasisPerUnit: Number(e.target.value) })}
                    />
                  </div>

                  <div>
                    <label className="block text-sm mb-1">Current price ($)</label>
                    <Input
                      type="number"
                      value={editing.currentPrice ?? 1}
                      onChange={(e) => setEditing({ ...editing, currentPrice: Number(e.target.value) })}
                    />
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
