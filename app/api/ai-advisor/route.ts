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
    const body = (await req.json()) as Partial<AdvisorRequest>;

    // Basic validation
    if (!body.profile) {
      return NextResponse.json(
        { markdown: "Missing profile. Please save your profile first." },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.positions) || body.positions.length === 0) {
      return NextResponse.json(
        { markdown: "No positions found. Add at least 1 position to generate insights." },
        { status: 400 },
      );
    }

    const safeBody: AdvisorRequest = {
      profile: body.profile,
      positions: body.positions,
      snapshot: body.snapshot ?? null,
      diversificationScore:
        typeof body.diversificationScore === "number" && Number.isFinite(body.diversificationScore)
          ? body.diversificationScore
          : 0,
    };

    const md = buildInsightsMarkdown(safeBody);
    return NextResponse.json({ markdown: md });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { markdown: `Failed to generate insights.\n\nError: ${msg}` },
      { status: 400 },
    );
  }
}

function buildInsightsMarkdown(req: AdvisorRequest): string {
  const { profile, positions, snapshot, diversificationScore } = req;

  const allocation = computeMix(positions);
  const top = topConcentrations(positions, 5);

  // If snapshot isn't present, compute a lightweight one from current prices
  const computed = snapshot ?? computeSnapshotFromPositions(positions);

  const lines: string[] = [];
  lines.push(`# AI Portfolio Insights`);
  lines.push("");
  lines.push(`> Educational guidance only. Not financial advice.`);
  lines.push("");

  lines.push(`## Risk & Allocation`);
  lines.push(
    `- Risk level: ${profile.riskLevel} (1 conservative – 5 aggressive), horizon: ${profile.investmentHorizonYears} years`,
  );
  lines.push(
    `- Current mix: Equity ~ ${pct(allocation.equity)}, Bonds ~ ${pct(allocation.bonds)}, Cash/MM ~ ${pct(
      allocation.cash,
    )}`,
  );

  if (computed) {
    lines.push(
      `- Portfolio value: $${computed.totalValue.toFixed(
        2,
      )}, Unrealized P/L: $${computed.totalGainLossDollar.toFixed(2)} (${computed.totalGainLossPercent.toFixed(2)}%)`,
    );
  }

  lines.push("");
  lines.push(`## Diversification & Concentration`);
  lines.push(`- Diversification score: ${diversificationScore}/100`);

  if (top.length) {
    lines.push(`- Top holdings by weight:`);
    for (const t of top) {
      lines.push(`  - ${t.ticker}: $${t.value.toFixed(2)} (${pct(t.percent)})`);
    }
  }

  lines.push(
    `- Consider whether any single position or asset class dominates your portfolio. Reducing concentration can help manage risk.`,
  );

  lines.push("");
  lines.push(`## Goal Alignment`);
  lines.push(
    `- Primary goal: ${profile.primaryGoal}${profile.goalDescription ? ` — ${profile.goalDescription}` : ""}`,
  );
  lines.push(
    `- Monthly contribution: ${profile.monthlyContribution != null ? `$${profile.monthlyContribution}` : "Not set"}`,
  );
  lines.push(
    `- With a ${profile.investmentHorizonYears}-year horizon, a diversified mix aligned to your risk level can help support this goal.`,
  );

  lines.push("");
  lines.push(`## Questions to Consider`);
  lines.push(`- Is your equity/bond/cash mix appropriate for your risk level and time horizon?`);
  lines.push(`- Are any single positions above ~15–20% of your total portfolio?`);
  lines.push(`- Do you have exposure across sectors and, if appropriate, international markets?`);
  lines.push(`- Are your contributions consistent with your goal timeline?`);
  lines.push("");

  lines.push(
    `> Disclaimer: This content is for educational and informational purposes only and is not financial, investment, or tax advice. No specific securities are recommended.`,
  );

  return lines.join("\n");
}

function computeMix(positions: Position[]): { equity: number; bonds: number; cash: number } {
  let equity = 0;
  let bonds = 0;
  let cash = 0;
  let total = 0;

  for (const p of positions) {
    const unit =
      typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
        ? p.currentPrice
        : p.costBasisPerUnit;

    const v = (Number(unit) || 0) * (Number(p.quantity) || 0);

    total += v;
    if (isEquityLike(p.assetClass)) equity += v;
    else if (isBondLike(p.assetClass)) bonds += v;
    else if (isCashLike(p.assetClass)) cash += v;
    else equity += v;
  }

  if (total === 0) return { equity: 0, bonds: 0, cash: 0 };
  return { equity: equity / total, bonds: bonds / total, cash: cash / total };
}

function topConcentrations(
  positions: Position[],
  limit = 5,
): { ticker: string; value: number; percent: number }[] {
  const byTicker = new Map<string, number>();

  let total = 0;
  for (const p of positions) {
    const unit =
      typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
        ? p.currentPrice
        : p.costBasisPerUnit;

    const v = (Number(unit) || 0) * (Number(p.quantity) || 0);
    total += v;

    const t = (p.ticker || "").toUpperCase().trim() || "UNKNOWN";
    byTicker.set(t, (byTicker.get(t) ?? 0) + v);
  }

  if (total <= 0) return [];

  const rows = Array.from(byTicker.entries()).map(([ticker, value]) => ({
    ticker,
    value,
    percent: value / total,
  }));

  rows.sort((a, b) => b.percent - a.percent);
  return rows.slice(0, limit);
}

function computeSnapshotFromPositions(positions: Position[]): PortfolioSnapshot {
  const totalValue = positions.reduce((acc, p) => {
    const unit =
      typeof p.currentPrice === "number" && Number.isFinite(p.currentPrice)
        ? p.currentPrice
        : p.costBasisPerUnit;
    return acc + (Number(unit) || 0) * (Number(p.quantity) || 0);
  }, 0);

  const totalCost = positions.reduce((acc, p) => {
    return acc + (Number(p.costBasisPerUnit) || 0) * (Number(p.quantity) || 0);
  }, 0);

  const totalGainLossDollar = totalValue - totalCost;
  const totalGainLossPercent = totalCost > 0 ? (totalGainLossDollar / totalCost) * 100 : 0;

  // Minimal snapshot shape (matches your usage)
  return {
    at: new Date().toISOString(),
    totalValue,
    totalGainLossDollar,
    totalGainLossPercent,
    positions: [],
  } as PortfolioSnapshot;
}

function pct(n: number) {
  return `${Math.round((n || 0) * 100)}%`;
}
