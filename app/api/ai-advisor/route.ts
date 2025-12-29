import { NextResponse } from "next/server";
import {
  PortfolioSnapshot,
  Position,
  UserProfile,
  isBondLike,
  isCashLike,
  isEquityLike,
} from "@/lib/types";

interface AdvisorRequest {
  profile: UserProfile;
  positions: Position[];
  snapshot: PortfolioSnapshot | null;
  diversificationScore: number;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AdvisorRequest;
    const md = buildInsightsMarkdown(body);
    return NextResponse.json({ markdown: md });
  } catch {
    return NextResponse.json({ markdown: "# Error\nFailed to generate insights." }, { status: 400 });
  }
}

function buildInsightsMarkdown(req: AdvisorRequest): string {
  const { profile, positions, snapshot, diversificationScore } = req;

  const mix = computeMix(positions);
  const top = topHoldings(positions, 3);

  const lines: string[] = [];

  lines.push("# AI Portfolio Insights");
  lines.push("> Educational only. Not financial advice.");
  lines.push("");

  lines.push("## Snapshot");
  lines.push(`- Risk level: ${profile.riskLevel}/5 • Horizon: ${profile.investmentHorizonYears}y • Goal: ${profile.primaryGoal}`);
  lines.push(`- Allocation: Equity ${pct(mix.equity)}, Bonds ${pct(mix.bonds)}, Cash/MM ${pct(mix.cash)}`);
  if (snapshot) {
    lines.push(
      `- Value: $${snapshot.totalValue.toFixed(2)} • Unrealized P/L: $${snapshot.totalGainLossDollar.toFixed(2)} (${snapshot.totalGainLossPercent.toFixed(2)}%)`,
    );
  }
  lines.push("");

  lines.push("## Concentration");
  lines.push(`- Diversification score: ${diversificationScore}/100`);
  if (top.length) {
    for (const t of top) {
      lines.push(`- ${t.ticker}: $${t.value.toFixed(2)} (${Math.round(t.weight * 100)}%)`);
    }
  } else {
    lines.push("- Add positions to see top holdings.");
  }
  lines.push("");

  lines.push("## What to do next");
  const actions: string[] = [];
  if (mix.equity > 0.8) actions.push("Consider adding bonds/cash if you want to reduce volatility.");
  if (top[0] && top[0].weight > 0.2) actions.push("Reduce single-ticker concentration to manage idiosyncratic risk.");
  if (actions.length === 0) actions.push("Your mix looks reasonable for your selected risk level — keep contributions consistent.");
  for (const a of actions.slice(0, 3)) lines.push(`- ${a}`);

  lines.push("");
  lines.push("> Disclaimer: No specific securities are recommended. Educational and informational purposes only.");

  return lines.join("\n");
}

function computeMix(positions: Position[]): { equity: number; bonds: number; cash: number } {
  let equity = 0;
  let bonds = 0;
  let cash = 0;
  let total = 0;

  for (const p of positions) {
    const v = (p.currentPrice ?? p.costBasisPerUnit) * p.quantity;
    total += v;

    if (isEquityLike(p.assetClass)) equity += v;
    else if (isBondLike(p.assetClass)) bonds += v;
    else if (isCashLike(p.assetClass)) cash += v;
    else equity += v;
  }

  if (total <= 0) return { equity: 0, bonds: 0, cash: 0 };
  return { equity: equity / total, bonds: bonds / total, cash: cash / total };
}

function topHoldings(positions: Position[], n: number) {
  const byTicker = new Map<string, number>();
  let total = 0;

  for (const p of positions) {
    const t = (p.ticker || "").toUpperCase();
    const v = (p.currentPrice ?? p.costBasisPerUnit) * p.quantity;
    if (!t) continue;
    byTicker.set(t, (byTicker.get(t) ?? 0) + v);
    total += v;
  }

  if (total <= 0) return [];

  return Array.from(byTicker.entries())
    .map(([ticker, value]) => ({ ticker, value, weight: value / total }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
}

function pct(n: number) {
  return `${Math.round((n || 0) * 100)}%`;
}
