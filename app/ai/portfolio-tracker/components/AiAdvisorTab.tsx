"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { isBondLike, isCashLike, isEquityLike, targetMixForRisk } from "@/lib/types";
import { valueForPosition } from "@/lib/portfolioStorage";
import { fmtMoney, fmtNumber } from "@/lib/format";

type Mix = { equity: number; bonds: number; cash: number };

type Tone = "good" | "warn" | "neutral";

type WatchItem = {
  title: string;
  level: Tone;
  detail: string;
};

type MoveItem = {
  title: string;
  detail: string;
};

function getNumberField(obj: unknown, keys: string[], fallback: number): number {
  if (!obj || typeof obj !== "object") return fallback;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function getStringField(obj: unknown, keys: string[], fallback: string): string {
  if (!obj || typeof obj !== "object") return fallback;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return fallback;
}

export default function AiAdvisorTab() {
  const { state, diversificationScore, diversificationDetails, topConcentrations } = usePortfolioState();
  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState<string>("");

  const snapshot = state.snapshots.at(-1) ?? null;

  // ✅ Use valueForPosition() so Cash/MM valuation matches your storage rules
  const { currentMix, totals } = useMemo(() => {
    const totals = state.positions.reduce(
      (acc, p) => {
        const v = valueForPosition(p);

        if (isEquityLike(p.assetClass)) acc.equity += v;
        else if (isBondLike(p.assetClass)) acc.bonds += v;
        else if (isCashLike(p.assetClass)) acc.cash += v;
        else acc.equity += v; // default bucket

        acc.total += v;
        return acc;
      },
      { equity: 0, bonds: 0, cash: 0, total: 0 },
    );

    const mix: Mix = {
      equity: totals.total ? totals.equity / totals.total : 0,
      bonds: totals.total ? totals.bonds / totals.total : 0,
      cash: totals.total ? totals.cash / totals.total : 0,
    };

    return { currentMix: mix, totals };
  }, [state.positions]);

  const target = targetMixForRisk(state.profile?.riskLevel ?? 3);

  const rebalanceLines = useMemo(() => {
    const format = (n: number) => `${Math.round(n * 100)}%`;
    return [
      `Equity: target ${format(target.equity)} vs current ${format(currentMix.equity)} (${deltaText(
        currentMix.equity - target.equity,
      )})`,
      `Bonds: target ${format(target.bonds)} vs current ${format(currentMix.bonds)} (${deltaText(
        currentMix.bonds - target.bonds,
      )})`,
      `Cash/MM: target ${format(target.cash)} vs current ${format(currentMix.cash)} (${deltaText(
        currentMix.cash - target.cash,
      )})`,
    ];
  }, [currentMix.equity, currentMix.bonds, currentMix.cash, target.equity, target.bonds, target.cash]);

  const canGenerate = !!state.profile && state.positions.length > 0;

  /**
   * Portfolio DNA:
   * concise, “clever”, high-signal and deterministic
   */
  const dna = useMemo(() => {
    const profile = state.profile ?? null;

    const risk = profile?.riskLevel ?? 3;

    // Type-safe compatibility with different profile shapes
    const horizon = getNumberField(profile, ["horizonYears", "investmentHorizonYears"], 20);
    const goal = getStringField(profile, ["goal", "primaryGoal"], "Wealth Building");

    const cashPct = currentMix.cash;

    const top1 = topConcentrations?.[0];
    const top1Pct = top1?.percent ?? 0;
    const top3Pct = (topConcentrations ?? []).slice(0, 3).reduce((a, x) => a + (x.percent ?? 0), 0);

    // “portfolio identity” label
    let label = "Balanced Builder";
    let tone: Tone = "neutral";

    if (cashPct > 0.35) {
      label = "Cash-Heavy Builder";
      tone = "warn";
    } else if (top1Pct > 0.2) {
      label = "Concentration Tilt";
      tone = "warn";
    } else if (diversificationScore >= 85) {
      label = "Balanced Operator";
      tone = "good";
    }

    const tier = diversificationDetails?.tier?.toLowerCase() ?? "mixed";

    const oneLiner =
      totals.total <= 0
        ? "Add positions to generate insights."
        : `A ${goal.toLowerCase()} portfolio with ${pct(cashPct, 0)} in Cash/MM and a ${tier} diversification profile.`;

    // Watchlist
    const watch: WatchItem[] = [];

    if (cashPct > 0.35) {
      watch.push({
        title: "Cash drag risk",
        level: "warn",
        detail: `Cash/MM is ${pct(cashPct, 0)}. If this isn’t intentional (near-term goal), long-run growth can suffer.`,
      });
    } else if (cashPct > 0.2) {
      watch.push({
        title: "Cash is elevated",
        level: "neutral",
        detail: `Cash/MM is ${pct(cashPct, 0)}. Fine short-term, but consider a target band (ex: 5–15%).`,
      });
    } else {
      watch.push({
        title: "Cash is controlled",
        level: "good",
        detail: `Cash/MM is ${pct(cashPct, 0)} — you’re mostly invested and compounding.`,
      });
    }

    if (top1Pct > 0.2) {
      watch.push({
        title: "Concentration flag",
        level: "warn",
        detail: `Top holding (${top1?.ticker ?? "—"}) is ${pct(top1Pct, 0)}. Great if intentional; risky if accidental.`,
      });
    } else if (top1Pct > 0.1) {
      watch.push({
        title: "Moderate concentration",
        level: "neutral",
        detail: `Top holding is ${pct(top1Pct, 0)}. Not bad — just keep it intentional.`,
      });
    } else {
      watch.push({
        title: "Concentration looks healthy",
        level: "good",
        detail: `Top holding is ${pct(top1Pct, 0)} — diversification is doing its job.`,
      });
    }

    // 3 moves
    const moves: MoveItem[] = [
      {
        title: "1) Set a cash rule",
        detail:
          cashPct > 0.2
            ? `Pick a Cash/MM band (ex: 5–15%). You’re at ${pct(cashPct, 0)} — the gap is your “deploy over time” number.`
            : `Keep Cash/MM inside a band (ex: 5–15%) so rebalancing stays disciplined.`,
      },
      {
        title: "2) Fix the biggest mismatch first",
        detail: `Use Rebalance → “Match current” then adjust targets. Put new money where Δ-to-target is most positive.`,
      },
      {
        title: "3) Keep concentration intentional",
        detail:
          top1Pct > 0.2
            ? `Over time, aim for top holding < ~20% unless it’s a broad index. You’re at ${pct(top1Pct, 0)}.`
            : `Keep top-3 under ~60% over time. You’re at ${pct(top3Pct, 0)}.`,
      },
    ];

    return { risk, horizon, goal, label, tone, oneLiner, top1, top1Pct, top3Pct, watch, moves };
  }, [
    state.profile,
    currentMix.cash,
    totals.total,
    topConcentrations,
    diversificationScore,
    diversificationDetails?.tier,
  ]);

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
          diversificationDetails,
        }),
      });

      const data = await res.json();
      const raw = String(data.markdown ?? "## No insights available\nTry again.");
      setMarkdown(stripDuplicateH1(raw));
    } catch {
      setMarkdown("## Error\nFailed to generate insights. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [state.profile, state.positions, snapshot, diversificationScore, diversificationDetails]);

  return (
    <div className="space-y-4">
      {/* HERO / DNA */}
      <Card>
        <CardHeader className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              AI Portfolio Insights
              <Badge text={dna.label} tone={dna.tone} />
            </CardTitle>

            <div className="text-sm text-gray-600 flex flex-wrap items-center gap-2">
              <span>
                Risk <span className="font-medium text-gray-900">{dna.risk}/5</span> • Horizon{" "}
                <span className="font-medium text-gray-900">{dna.horizon}y</span> • Goal{" "}
                <span className="font-medium text-gray-900">{dna.goal}</span>
              </span>
              <span className="text-gray-300">•</span>
              <span>
                Diversification{" "}
                <span className="font-medium text-gray-900">{diversificationScore}/100</span>{" "}
                <span className="text-gray-500">({diversificationDetails?.tier ?? "—"})</span>
              </span>
            </div>
          </div>

          <Button
            onClick={regenerate}
            disabled={loading || !canGenerate}
            title={!canGenerate ? "Add profile + positions first" : ""}
            className="whitespace-nowrap"
          >
            {loading ? "Generating…" : "Regenerate insights"}
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-xl border bg-gray-50 p-4">
            <div className="text-xs text-gray-500">Educational only. Not financial advice.</div>
            <div className="mt-2 text-sm text-gray-900">{dna.oneLiner}</div>
          </div>

          {/* QUICK SIGNALS */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <MiniStat
              title="Total value"
              value={fmtMoney(totals.total)}
              sub={`Cash/MM ${fmtMoney(totals.cash)} • ${pct(currentMix.cash, 0)}`}
            />
            <MiniStat
              title="Top holding"
              value={dna.top1?.ticker ?? "—"}
              sub={`Weight ${pct(dna.top1Pct, 0)} • Top 3 ${pct(dna.top3Pct, 0)}`}
            />
            <MiniStat
              title="Mix now"
              value={`${pct(currentMix.equity, 0)} / ${pct(currentMix.bonds, 0)} / ${pct(currentMix.cash, 0)}`}
              sub="Equity / Bonds / Cash-MM"
            />
          </div>

          {/* MARKDOWN (LLM) */}
          {markdown ? (
            <div className="rounded-xl border bg-white p-4">
              <MarkdownLite text={markdown} />
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              Click <span className="font-medium">Regenerate insights</span> for an AI narrative + deeper breakdown.
            </div>
          )}
        </CardContent>
      </Card>

      {/* WATCHLIST + 3 MOVES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Watchlist (what could bite you)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dna.watch.map((w, i) => (
              <div key={i} className="rounded-lg border bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-900">{w.title}</div>
                  <Badge text={w.level === "warn" ? "Watch" : w.level === "good" ? "Good" : "Note"} tone={w.level} />
                </div>
                <div className="mt-1 text-sm text-gray-600">{w.detail}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Action plan (3 moves)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dna.moves.map((m, i) => (
              <div key={i} className="rounded-lg border bg-white p-3">
                <div className="text-sm font-semibold text-gray-900">{m.title}</div>
                <div className="mt-1 text-sm text-gray-600">{m.detail}</div>
              </div>
            ))}
            <div className="text-xs text-gray-500 pt-2">
              Workflow: set targets → use Rebalance with “New money” → (if applicable) rebalance inside Roth first.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* QUICK REBALANCE SUMMARY */}
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

/* ---------- small UI helpers ---------- */

function Badge({ text, tone }: { text: string; tone: Tone }) {
  const cls =
    tone === "good"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-gray-50 text-gray-700 border-gray-200";

  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>{text}</span>;
}

function MiniStat(props: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs text-gray-500">{props.title}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{props.value}</div>
      {props.sub ? <div className="mt-1 text-xs text-gray-600">{props.sub}</div> : null}
    </div>
  );
}

/* ---------- formatting helpers ---------- */

function stripDuplicateH1(md: string) {
  const lines = md.split("\n");
  if (lines[0]?.trim() === "# AI Portfolio Insights") {
    return lines.slice(1).join("\n").replace(/^\s*\n/, "");
  }
  return md;
}

function deltaText(delta: number): string {
  const pct = Math.round(delta * 100);
  if (pct === 0) return "aligned";
  if (pct > 0) return `overweight by ${pct}%`;
  return `underweight by ${Math.abs(pct)}%`;
}

function pct(n: number, d = 0) {
  return `${fmtNumber((n || 0) * 100, d)}%`;
}

/**
 * Lightweight markdown rendering without adding deps.
 * Supports: # / ## headings, bullets (-), blockquotes (>), and tables (|...|)
 */
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");

  // group contiguous table lines
  const blocks: { type: "table" | "line"; lines: string[] }[] = [];
  let i = 0;

  const isTableLine = (l: string) => {
    const s = l.trim();
    return s.startsWith("|") && s.includes("|");
  };

  while (i < lines.length) {
    const raw = lines[i];
    if (isTableLine(raw)) {
      const tbl: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        tbl.push(lines[i]);
        i++;
      }
      blocks.push({ type: "table", lines: tbl });
      continue;
    }
    blocks.push({ type: "line", lines: [raw] });
    i++;
  }

  return (
    <div className="space-y-2">
      {blocks.map((b, idx) => {
        if (b.type === "table") {
          return <MarkdownTable key={idx} lines={b.lines} />;
        }

        const raw = b.lines[0];
        const line = raw.trim();
        if (!line) return <div key={idx} className="h-2" />;

        if (line.startsWith("# ")) {
          return (
            <h2 key={idx} className="text-lg font-semibold text-gray-900">
              {line.replace(/^#\s+/, "")}
            </h2>
          );
        }

        if (line.startsWith("## ")) {
          return (
            <h3 key={idx} className="text-base font-semibold text-gray-900 mt-3">
              {line.replace(/^##\s+/, "")}
            </h3>
          );
        }

        if (line.startsWith("### ")) {
          return (
            <h4 key={idx} className="text-sm font-semibold text-gray-900 mt-2">
              {line.replace(/^###\s+/, "")}
            </h4>
          );
        }

        if (line.startsWith(">")) {
          return (
            <div key={idx} className="rounded-lg border bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {line.replace(/^>\s?/, "")}
            </div>
          );
        }

        if (line.startsWith("- ")) {
          return (
            <div key={idx} className="flex gap-2 text-sm text-gray-800">
              <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-gray-400" />
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

function MarkdownTable({ lines }: { lines: string[] }) {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length < 2) return null;

  const parseRow = (row: string) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const header = parseRow(cleaned[0]);
  const bodyRows = cleaned
    .slice(2) // skip separator
    .map(parseRow)
    .filter((r) => r.length);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {header.map((h, i) => (
              <th
                key={i}
                className={`px-3 py-2 font-semibold text-gray-900 ${i === 0 ? "text-left" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((r, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
              {r.map((c, ci) => (
                <td key={ci} className={`px-3 py-2 text-gray-800 ${ci === 0 ? "text-left" : "text-right"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
