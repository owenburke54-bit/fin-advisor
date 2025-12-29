"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { isBondLike, isCashLike, isEquityLike, targetMixForRisk } from "@/lib/types";

export default function AiAdvisorTab() {
  const { state, diversificationScore } = usePortfolioState();
  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState<string>("");

  const snapshot = state.snapshots.at(-1) ?? null;

  const currentMix = useMemo(() => {
    const totals = state.positions.reduce(
      (acc, p) => {
        const v = (p.currentPrice ?? p.costBasisPerUnit) * p.quantity;
        if (isEquityLike(p.assetClass)) acc.equity += v;
        else if (isBondLike(p.assetClass)) acc.bonds += v;
        else if (isCashLike(p.assetClass)) acc.cash += v;
        else acc.equity += v;
        acc.total += v;
        return acc;
      },
      { equity: 0, bonds: 0, cash: 0, total: 0 },
    );

    return {
      equity: totals.total ? totals.equity / totals.total : 0,
      bonds: totals.total ? totals.bonds / totals.total : 0,
      cash: totals.total ? totals.cash / totals.total : 0,
    };
  }, [state.positions]);

  const target = targetMixForRisk(state.profile?.riskLevel ?? 3);

  const rebalanceLines = useMemo(() => {
    const format = (n: number) => `${Math.round(n * 100)}%`;
    return [
      `Equity: target ${format(target.equity)} vs current ${format(currentMix.equity)} (${deltaText(currentMix.equity - target.equity)})`,
      `Bonds: target ${format(target.bonds)} vs current ${format(currentMix.bonds)} (${deltaText(currentMix.bonds - target.bonds)})`,
      `Cash/MM: target ${format(target.cash)} vs current ${format(currentMix.cash)} (${deltaText(currentMix.cash - target.cash)})`,
    ];
  }, [currentMix.equity, currentMix.bonds, currentMix.cash, target.equity, target.bonds, target.cash]);

  const canGenerate = !!state.profile && state.positions.length > 0;

  const regenerate = useCallback(async () => {
    if (!state.profile) {
      setMarkdown("## Add your profile\nSave your profile to generate insights.");
      return;
    }
    if (state.positions.length === 0) {
      setMarkdown("## Add positions\nAdd at least one position to generate insights.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/ai-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: state.profile,
          positions: state.positions,
          snapshot,
          diversificationScore,
        }),
      });

      const data = await res.json();
      setMarkdown(data.markdown ?? "## No insights available\nTry again.");
    } catch {
      setMarkdown("## Error\nFailed to generate insights. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [state.profile, state.positions, snapshot, diversificationScore]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>AI Portfolio Insights</CardTitle>
          <Button onClick={regenerate} disabled={loading || !canGenerate} title={!canGenerate ? "Add profile + positions first" : ""}>
            {loading ? "Generating…" : "Regenerate insights"}
          </Button>
        </CardHeader>

        <CardContent>
          {markdown ? (
            <MarkdownLite text={markdown} />
          ) : (
            <div className="text-sm text-gray-600">
              Add your profile + positions, then click <span className="font-medium">Regenerate insights</span>.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Rebalance Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-1">
            {rebalanceLines.map((l, i) => (
              <li key={i} className="text-gray-800">
                {l}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-600">Hypothetical target mix for educational purposes.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function deltaText(delta: number): string {
  const pct = Math.round(delta * 100);
  if (pct === 0) return "aligned";
  if (pct > 0) return `overweight by ${pct}%`;
  return `underweight by ${Math.abs(pct)}%`;
}

/**
 * Lightweight markdown rendering without adding deps.
 * Supports: # / ## headings, bullets (-), and blockquotes (>)
 */
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="space-y-2">
      {lines.map((raw, idx) => {
        const line = raw.trim();
        if (!line) return <div key={idx} className="h-1" />;

        if (line.startsWith("# ")) {
          return (
            <h2 key={idx} className="text-base font-semibold text-gray-900">
              {line.replace(/^#\s+/, "")}
            </h2>
          );
        }

        if (line.startsWith("## ")) {
          return (
            <h3 key={idx} className="text-sm font-semibold text-gray-900 mt-2">
              {line.replace(/^##\s+/, "")}
            </h3>
          );
        }

        if (line.startsWith(">")) {
          return (
            <div key={idx} className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {line.replace(/^>\s?/, "")}
            </div>
          );
        }

        if (line.startsWith("- ")) {
          return (
            <div key={idx} className="flex gap-2 text-sm text-gray-800">
              <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-gray-400" />
              <div>{line.replace(/^- /, "")}</div>
            </div>
          );
        }

        return (
          <p key={idx} className="text-sm text-gray-800 leading-relaxed">
            {line}
          </p>
        );
      })}
    </div>
  );
}
