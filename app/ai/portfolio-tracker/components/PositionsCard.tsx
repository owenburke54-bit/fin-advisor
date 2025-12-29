"use client";

import { useMemo, useState } from "react";
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

function fmtDollar(n: number) {
  const v = Number(n) || 0;
  return `$${v.toFixed(2)}`;
}

function fmtQty(n: number) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export default function PositionsCard() {
  const { state, addPosition, updatePosition, deletePosition, exportCSV, exportJSON, refreshPrices } = usePortfolioState();

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

  const hasPositions = state.positions.length > 0;
  const totalPositions = state.positions.length;

  const sortedPositions = useMemo(() => {
    return [...state.positions].sort((a, b) => valueForPosition(b) - valueForPosition(a));
  }, [state.positions]);

  function normalizeCashLikeFields<
    T extends { assetClass: AssetClass; quantity: number; costBasisPerUnit: number; currentPrice?: number }
  >(obj: T): T {
    if (!isCashLike(obj.assetClass)) return obj;
    return {
      ...obj,
      // for cash-like: treat quantity as balance, prices default to 1
      costBasisPerUnit: Number.isFinite(obj.costBasisPerUnit) && obj.costBasisPerUnit > 0 ? obj.costBasisPerUnit : 1,
      currentPrice:
        typeof obj.currentPrice === "number" && Number.isFinite(obj.currentPrice) && obj.currentPrice > 0 ? obj.currentPrice : 1,
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

  // Live preview (derived fields)
  const preview = useMemo(() => {
    const qty = Number(form.quantity) || 0;
    const cost = Number(form.costBasisPerUnit) || 0;
    const current = typeof form.currentPrice === "number" ? Number(form.currentPrice) : undefined;

    if (qty <= 0) return null;

    const unit = typeof current === "number" ? current : cost;
    const value = unit * qty;
    const plDollar = (unit - cost) * qty;
    const costTotal = cost * qty;
    const plPct = costTotal > 0 ? (plDollar / costTotal) * 100 : 0;

    return { value, plDollar, plPct };
  }, [form.quantity, form.costBasisPerUnit, form.currentPrice]);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Positions</CardTitle>
            <CardDescription>Add your holdings and manage them here.</CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
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
        {/* Add form - reordered: ticker, name, asset, account, qty, initial, current */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-8 gap-3">
            {/* Ticker */}
            <div className="sm:col-span-1">
              <label className="block text-sm mb-1">Ticker</label>
              <Input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} />
              {errors.ticker && <p className="text-xs text-red-600 mt-1">{errors.ticker}</p>}
            </div>

            {/* Name */}
            <div className="sm:col-span-2">
              <label className="block text-sm mb-1">Name</label>
              <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>

            {/* Asset */}
            <div>
              <label className="block text-sm mb-1">Asset</label>
              <Select value={form.assetClass} onChange={(e) => setForm({ ...form, assetClass: e.target.value as AssetClass })}>
                {ASSET_CLASSES.map((ac) => (
                  <option key={ac} value={ac}>
                    {ac}
                  </option>
                ))}
              </Select>
            </div>

            {/* Account */}
            <div>
              <label className="block text-sm mb-1">Account</label>
              <Select value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value as AccountType })}>
                {ACCOUNT_TYPES.map((at) => (
                  <option key={at} value={at}>
                    {at}
                  </option>
                ))}
              </Select>
            </div>

            {/* Quantity / Balance */}
            <div>
              <label className="block text-sm mb-1">{isCashLike(form.assetClass) ? "Balance ($)" : "Quantity"}</label>
              <Input
                type="number"
                value={form.quantity}
                onChange={(e) =>
                  setForm({
                    ...form,
                    quantity: Number(e.target.value),
                    // cash-like defaults
                    ...(isCashLike(form.assetClass)
                      ? {
                          costBasisPerUnit: form.costBasisPerUnit || 1,
                          currentPrice: form.currentPrice ?? 1,
                        }
                      : {}),
                  })
                }
              />
              {errors.quantity && <p className="text-xs text-red-600 mt-1">{errors.quantity}</p>}
            </div>

            {/* Initial price */}
            <div>
              <label className="block text-sm mb-1">{isCashLike(form.assetClass) ? "Initial price ($)" : "Initial price"}</label>
              <Input
                type="number"
                value={isCashLike(form.assetClass) ? form.costBasisPerUnit || 1 : form.costBasisPerUnit}
                onChange={(e) => setForm({ ...form, costBasisPerUnit: Number(e.target.value) })}
              />
              {errors.costBasisPerUnit && <p className="text-xs text-red-600 mt-1">{errors.costBasisPerUnit}</p>}
              {isCashLike(form.assetClass) && <p className="text-xs text-gray-600 mt-1">Usually $1.00 for money markets.</p>}
            </div>

            {/* Current price */}
            <div>
              <label className="block text-sm mb-1">Current price</label>
              <Input
                type="number"
                value={
                  isCashLike(form.assetClass)
                    ? form.currentPrice ?? 1
                    : typeof form.currentPrice === "number"
                      ? form.currentPrice
                      : ""
                }
                placeholder={isCashLike(form.assetClass) ? "" : "Auto-fetch"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    currentPrice:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </div>
          </div>

          {/* Derived preview: Value + P/L */}
          {preview && (
            <div className="flex flex-wrap gap-6 rounded-lg border bg-gray-50 px-3 py-2 text-sm text-gray-700">
              <div>
                <span className="font-medium">Value:</span> {fmtDollar(preview.value)}
              </div>
              <div>
                <span className="font-medium">P/L:</span>{" "}
                <span className={preview.plDollar >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                  {preview.plDollar >= 0 ? "+" : ""}
                  {fmtDollar(preview.plDollar).replace("$-", "-$")}
                </span>{" "}
                <span className="text-gray-500">
                  ({preview.plPct >= 0 ? "+" : ""}
                  {preview.plPct.toFixed(2)}%)
                </span>
              </div>
            </div>
          )}

          <div>
            <Button onClick={handleAdd}>Add Position</Button>
          </div>
        </div>

        {/* Table */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">{totalPositions} positions</p>
          </div>

          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="px-2 py-2 w-[72px]">Ticker</th>
                  <th className="px-2 py-2 min-w-[240px]">Name</th>
                  <th className="px-2 py-2 hidden md:table-cell w-[110px]">Asset</th>
                  <th className="px-2 py-2 hidden lg:table-cell w-[140px]">Account</th>
                  <th className="px-2 py-2 text-right hidden md:table-cell w-[90px]">Qty</th>
                  <th className="px-2 py-2 text-right hidden md:table-cell w-[110px]">Initial</th>
                  <th className="px-2 py-2 text-right hidden lg:table-cell w-[110px]">Current</th>
                  <th className="px-2 py-2 text-right w-[110px]">Value</th>
                  <th className="px-2 py-2 text-right hidden sm:table-cell w-[110px]">P/L</th>
                  <th className="px-2 py-2 text-right w-[170px]">Actions</th>
                </tr>
              </thead>

              <tbody>
                {sortedPositions.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-2 py-6 text-center text-gray-600">
                      Add your first position (e.g., AAPL, VOO, BTCUSD).
                    </td>
                  </tr>
                ) : (
                  sortedPositions.map((p) => {
                    const value = valueForPosition(p);
                    const costTotal = p.costBasisPerUnit * p.quantity;
                    const plDollar = value - costTotal;
                    const plPct = costTotal > 0 ? (plDollar / costTotal) * 100 : 0;

                    return (
                      <tr key={p.id} className="border-t align-top">
                        <td className="px-2 py-3 font-semibold text-gray-900">{p.ticker}</td>

                        <td className="px-2 py-3">
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 break-words">{p.name}</div>

                            <div className="mt-1 text-xs text-gray-500 md:hidden">
                              {p.assetClass} • {p.accountType} • Qty {fmtQty(p.quantity)}
                            </div>
                          </div>
                        </td>

                        <td className="px-2 py-3 hidden md:table-cell">{p.assetClass}</td>
                        <td className="px-2 py-3 hidden lg:table-cell">{p.accountType}</td>

                        <td className="px-2 py-3 text-right hidden md:table-cell">{fmtQty(p.quantity)}</td>
                        <td className="px-2 py-3 text-right hidden md:table-cell">{fmtDollar(p.costBasisPerUnit)}</td>
                        <td className="px-2 py-3 text-right hidden lg:table-cell">
                          {typeof p.currentPrice === "number" ? fmtDollar(p.currentPrice) : "—"}
                        </td>

                        <td className="px-2 py-3 text-right font-medium">{fmtDollar(value)}</td>

                        <td className={`px-2 py-3 text-right hidden sm:table-cell ${plDollar >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          <div className="font-medium">
                            {plDollar >= 0 ? "+" : ""}
                            {fmtDollar(plDollar).replace("$-", "-$")}
                          </div>
                          <div className="text-xs">
                            {plPct >= 0 ? "+" : ""}
                            {plPct.toFixed(2)}%
                          </div>
                        </td>

                        <td className="px-2 py-3">
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => startEdit(p)}>
                              Edit
                            </Button>
                            <Button variant="destructive" onClick={() => deletePosition(p.id)}>
                              Delete
                            </Button>
                          </div>

                          <div className="sm:hidden mt-2 text-right text-xs">
                            <span className={plDollar >= 0 ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
                              {plDollar >= 0 ? "+" : ""}
                              {fmtDollar(plDollar).replace("$-", "-$")}
                            </span>{" "}
                            <span className="text-gray-500">
                              ({plPct >= 0 ? "+" : ""}
                              {plPct.toFixed(2)}%)
                            </span>
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
                <Input value={editing.ticker} onChange={(e) => setEditing({ ...editing, ticker: e.target.value.toUpperCase() })} />
              </div>

              <div>
                <label className="block text-sm mb-1">Name</label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>

              <div>
                <label className="block text-sm mb-1">Asset class</label>
                <Select value={editing.assetClass} onChange={(e) => setEditing({ ...editing, assetClass: e.target.value as AssetClass })}>
                  {ASSET_CLASSES.map((ac) => (
                    <option key={ac} value={ac}>
                      {ac}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-sm mb-1">Account type</label>
                <Select value={editing.accountType} onChange={(e) => setEditing({ ...editing, accountType: e.target.value as AccountType })}>
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
                    <label className="block text-sm mb-1">Initial price ($)</label>
                    <Input type="number" value={editing.costBasisPerUnit || 1} onChange={(e) => setEditing({ ...editing, costBasisPerUnit: Number(e.target.value) })} />
                  </div>

                  <div>
                    <label className="block text-sm mb-1">Current price ($)</label>
                    <Input type="number" value={editing.currentPrice ?? 1} onChange={(e) => setEditing({ ...editing, currentPrice: Number(e.target.value) })} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm mb-1">Quantity</label>
                    <Input type="number" value={editing.quantity} onChange={(e) => setEditing({ ...editing, quantity: Number(e.target.value) })} />
                  </div>

                  <div>
                    <label className="block text-sm mb-1">Initial price</label>
                    <Input type="number" value={editing.costBasisPerUnit} onChange={(e) => setEditing({ ...editing, costBasisPerUnit: Number(e.target.value) })} />
                  </div>

                  <div>
                    <label className="block text-sm mb-1">Current price (optional)</label>
                    <Input
                      type="number"
                      value={typeof editing.currentPrice === "number" ? editing.currentPrice : ""}
                      placeholder="Auto-fetch"
                      onChange={(e) => setEditing({ ...editing, currentPrice: e.target.value === "" ? undefined : Number(e.target.value) })}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm mb-1">Purchase date</label>
                <Input type="date" value={editing.purchaseDate ?? ""} onChange={(e) => setEditing({ ...editing, purchaseDate: e.target.value || undefined })} />
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
