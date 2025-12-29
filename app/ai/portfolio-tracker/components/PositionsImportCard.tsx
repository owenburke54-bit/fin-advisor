"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { usePortfolioState } from "@/lib/usePortfolioState";

export default function PositionsImportCard() {
  const { state, importCSV, clearPositions, refreshPrices } = usePortfolioState();

  const [importText, setImportText] = useState("");
  const [importErrs, setImportErrs] = useState<string[]>([]);

  const hasPositions = state.positions.length > 0;

  function handleImportCSV() {
    const res = importCSV(importText);
    setImportErrs(res.errors);

    if (res.success) {
      setImportText("");
      void refreshPrices();
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1">
        <CardTitle>Import</CardTitle>
        <CardDescription className="text-xs text-gray-500">
          Columns: ticker, name, assetClass, accountType, quantity, costBasisPerUnit, purchaseDate, currentPrice (optional)
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <textarea
          className="w-full min-h-[110px] rounded border p-2 text-sm"
          placeholder="Paste CSV here"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-gray-600">
            Tip: If you import the wrong file, use “Delete all” to start fresh.
          </div>

          <div className="flex gap-2">
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
        </div>

        {importErrs.length > 0 && (
          <ul className="list-disc pl-6 text-xs text-red-600">
            {importErrs.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
