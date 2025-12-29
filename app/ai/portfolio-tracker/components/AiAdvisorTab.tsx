"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { isBondLike, isCashLike, isEquityLike, targetMixForRisk } from "@/lib/types";

export default function AiAdvisorTab() {
  const { state, diversificationScore } = usePortfolioState();
  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState<string>("");

  const snapshot = state.snapshots.at(-1) ?? null;

  const hasProfile = !!state.profile;
  const hasPositions = state.positions.length > 0;

  const currentMix = useMemo(() => {
    const totals = state.positions.reduce(
      (acc, p) => {
        const unit =
          typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
            ? p.currentPrice
            : p.costBasisPerUnit;

        const v = (Number(unit) || 0) * (Number(p.quantity) || 0);

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
    const lines: string[] = [];
    const format = (n: number) => `${Math.round(n * 100)}%`;

    lines.push(
      `Target equity: ${format(target.equity)} — Current: ${format(currentMix.equity)} (${deltaText(
        currentMix.equity - target.equity,
      )}).`,
    );
    lines.push(
      `Target bonds: ${format(target.bonds)} — Current: ${format(currentMix.bonds)} (${deltaText(
        currentMix.bonds - target.bonds,
      )}).`,
    );
    lines.push(
      `Target cash/MM: ${format(target.cash)} — Current: ${format(currentMix.cash)} (${deltaText(
        currentMix.cash - target.cash,
      )}).`,
    );

    return lines;
  }, [currentMix.equity, currentMix.bonds, currentMix.cash, target.equity, target.bonds, target.cash]);

  const regenerate = useCallback(async () => {
    if (!hasProfile || !hasPositions) {
      setMarkdown("Add your profile and at least 1 position to generate insights.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/ai-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          profile: state.profile,
          positions: state.positions,
          snapshot,
          diversificationScore,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setMarkdown(
          `Failed to generate insights (HTTP ${res.status}).${
            text ? `\n\nDetails:\n${text}` : ""
          }`,
        );
        return;
      }

      const data = (await res.json()) as { markdown?: string };
      setMarkdown(data.markdown ?? "No insights available.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMarkdown(`Failed to generate insights. Please try again.\n\nError: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [hasProfile, hasPositions, state.profile, state.positions, snapshot, diversificationScore]);

  // Optional: auto-generate once after profile + positions exist
  useEffect(() => {
    if (!markdown && hasProfile && hasPositions) {
      void regenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProfile, hasPositions]);

  const emptyState = !hasProfile
    ? "Save your profile to unlock AI insights."
    : !hasPositions
      ? "Add at least 1 position to unlock AI insights."
      : 'Click “Regenerate insights” to generate educational guidance.';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>AI Portfolio Insights</CardTitle>
          <Button onClick={regenerate} disabled={loading || !hasProfile || !hasPositions}>
            {loading ? "Generating…" : "Regenerate insights"}
          </Button>
        </CardHeader>

        <CardContent>
          {markdown ? (
            <pre className="whitespace-pre-wrap text-sm leading-6 text-gray-900">{markdown}</pre>
          ) : (
            <p className="text-sm text-gray-600">{emptyState}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Rebalance Suggestions (Educational)</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-1">
            {rebalanceLines.map((l, i) => (
              <li key={i}>{l}</li>
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
