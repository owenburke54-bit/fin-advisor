import { NextResponse } from "next/server";
import { PortfolioSnapshot, Position, UserProfile, isBondLike, isCashLike, isEquityLike } from "@/lib/types";

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
    return NextResponse.json({ markdown: "Failed to generate insights." }, { status: 400 });
  }
}

function buildInsightsMarkdown(req: AdvisorRequest): string {
  const { profile, positions, snapshot, diversificationScore } = req;
  const allocation = computeMix(positions);
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
    `- Current mix: Equity ~ ${pct(allocation.equity)}, Bonds ~ ${pct(allocation.bonds)}, Cash/MM ~ ${pct(allocation.cash)}`,
  );
  if (snapshot) {
    lines.push(
      `- Portfolio value: $${snapshot.totalValue.toFixed(2)}, Unrealized P/L: $${snapshot.totalGainLossDollar.toFixed(2)} (${snapshot.totalGainLossPercent.toFixed(2)}%)`,
    );
  }
  lines.push("");
  lines.push(`## Diversification & Concentration`);
  lines.push(`- Diversification score: ${diversificationScore}/100`);
  lines.push(
    `- Consider whether any single position or asset class dominates your portfolio. Reducing concentration can help manage risk.`,
  );
  lines.push("");
  lines.push(`## Goal Alignment`);
  lines.push(`- Primary goal: ${profile.primaryGoal}${profile.goalDescription ? ` — ${profile.goalDescription}` : ""}`);
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
    const v = (p.currentPrice ?? p.costBasisPerUnit) * p.quantity;
    total += v;
    if (isEquityLike(p.assetClass)) equity += v;
    else if (isBondLike(p.assetClass)) bonds += v;
    else if (isCashLike(p.assetClass)) cash += v;
    else equity += v;
  }
  if (total === 0) return { equity: 0, bonds: 0, cash: 0 };
  return { equity: equity / total, bonds: bonds / total, cash: cash / total };
}

function pct(n: number) {
  return `${Math.round((n || 0) * 100)}%`;
}

