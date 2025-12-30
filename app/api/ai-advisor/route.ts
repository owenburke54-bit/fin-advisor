import { NextResponse } from "next/server";
import {
  PortfolioSnapshot,
  Position,
  UserProfile,
  isBondLike,
  isCashLike,
  isEquityLike,
  targetMixForRisk,
} from "@/lib/types";

type DiversificationDetails = {
  tier?: string;
  tierHint?: string;
  topHoldingTicker?: string | null;
  topHoldingPct?: number; // 0..1
  top3Pct?: number; // 0..1
  buckets?: { equity: number; bonds: number; cash: number; other: number };
  why?: string[];
};

interface AdvisorRequest {
  profile: UserProfile;
  positions: Position[];
  snapshot: PortfolioSnapshot | null;
  diversificationScore: number;
  diversificationDetails?: DiversificationDetails; // optional for backward compatibility
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
  const { profile, positions, snapshot, diversificationScore, diversificationDetails } = req;

  const totals = computeTotals(positions);
  const mix = totals.mixPct;
  const target = targetMixForRisk(profile.riskLevel);

  const rebalance = buildRebalancePlan({
    total: totals.total,
    current: totals.mixDollar,
    target,
  });

  const top = topHoldings(positions, 5);
  const concWarnings = concentrationWarnings(top);

  const hasRoth = positions.some((p) => p.accountType === "Roth IRA");

  const lines: string[] = [];

  lines.push("# AI Portfolio Insights");
  lines.push("> Educational only. Not financial advice.");
  lines.push("");

  // Snapshot
  lines.push("## Snapshot");
  lines.push(
    `- Risk level: ${profile.riskLevel}/5 • Horizon: ${profile.investmentHorizonYears}y • Goal: ${profile.primaryGoal}`,
  );
  lines.push(`- Current allocation: Equity ${pct(mix.equity)}, Bonds ${pct(mix.bonds)}, Cash/MM ${pct(mix.cash)}`);
  lines.push(
    `- Target allocation: Equity ${pct(target.equity)}, Bonds ${pct(target.bonds)}, Cash/MM ${pct(target.cash)}`,
  );

  if (snapshot) {
    lines.push(
      `- Value: ${money(snapshot.totalValue)} • Unrealized P/L: ${money(snapshot.totalGainLossDollar)} (${snapshot.totalGainLossPercent.toFixed(2)}%)`,
    );
  } else {
    lines.push(`- Portfolio value: ${money(totals.total)}`);
  }

  lines.push("");

  // Diversification
  lines.push("## Diversification");
  lines.push(`- Diversification score: ${diversificationScore}/100`);

  if (diversificationDetails?.tier) {
    lines.push(
      `- Tier: ${diversificationDetails.tier}${
        diversificationDetails.tierHint ? ` — ${diversificationDetails.tierHint}` : ""
      }`,
    );
  }

  const topHoldPct =
    typeof diversificationDetails?.topHoldingPct === "number" ? diversificationDetails.topHoldingPct : top[0]?.weight ?? 0;

  const top3Pct =
    typeof diversificationDetails?.top3Pct === "number"
      ? diversificationDetails.top3Pct
      : top.slice(0, 3).reduce((a, b) => a + b.weight, 0);

  if (top.length) {
    lines.push(`- Top holding: ${top[0]?.ticker ?? "—"} (${pct(topHoldPct)}) • Top 3: ${pct(top3Pct)}`);
  }

  if (concWarnings.length) {
    for (const w of concWarnings) lines.push(`- ${w}`);
  } else {
    lines.push("- No major concentration flags detected (based on common thresholds).");
  }

  if (diversificationDetails?.why?.length) {
    lines.push("");
    lines.push("### Why this score");
    for (const w of diversificationDetails.why.slice(0, 5)) lines.push(`- ${w}`);
  }

  lines.push("");

  // Action plan
  lines.push("## Action Plan (next 3 steps)");
  lines.push(
    `- 1) ${
      hasRoth
        ? "Rebalance inside your **Roth IRA** first (often avoids taxes), then adjust taxable accounts if needed."
        : "Rebalance in the lowest-tax-impact accounts first (retirement accounts if applicable), then taxable if needed."
    }`,
  );

  if (rebalance.actions.length) {
    for (const a of rebalance.actions.slice(0, 3)) lines.push(`${a}`);
  } else {
    lines.push("- 2) Your allocation is already close to target. Keep contributions consistent and rebalance periodically.");
  }

  lines.push("- 3) Reduce single-name risk over time: aim for top holding < 20% and top 3 holdings < 60% (general guideline).");

  lines.push("");

  // Rebalance table
  lines.push("## Rebalance Table");
  lines.push("| Bucket | Current % | Target % | Delta % | $ to move |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const row of rebalance.tableRows) {
    lines.push(
      `| ${row.bucket} | ${pct0(row.currentPct)} | ${pct0(row.targetPct)} | ${signedPct0(row.deltaPct)} | ${signedMoney(
        row.deltaDollar,
      )} |`,
    );
  }

  lines.push("");

  // How to implement (category-based)
  lines.push("## How to implement (category-based)");
  if (rebalance.primaryFundingSource === "cash") {
    lines.push(
      `- Primary funding source: **Cash/MM** (you’re overweight). Shift toward diversified **equity index funds** and/or **broad bond funds** based on your target mix.`,
    );
  } else if (rebalance.primaryFundingSource === "sell-overweights") {
    lines.push(
      `- You’re underweight Cash/MM. Use **new contributions** to build cash, or sell small amounts of overweight buckets and move to Cash/MM.`,
    );
  } else {
    lines.push(`- Best approach: use **new contributions** to close gaps (often simpler + more tax-friendly).`);
  }
  lines.push("- Equity examples (not recommendations): broad US index, total market, international index.");
  lines.push("- Bond examples (not recommendations): broad aggregate bond, short/intermediate-term bond funds.");

  lines.push("");

  // Risk notes
  lines.push("## Risk Notes");
  if (mix.cash > Math.max(target.cash + 0.1, 0.2)) {
    lines.push(`- Cash drag: Cash/MM at ${pct(mix.cash)} may reduce long-run growth vs your target.`);
  }
  if (mix.equity > Math.min(target.equity + 0.1, 0.9)) {
    lines.push(`- Volatility: Equity at ${pct(mix.equity)} may increase drawdowns vs your target.`);
  }
  lines.push("- Rebalance cadence idea: quarterly or when a bucket drifts ~5–10% from target.");

  lines.push("");
  lines.push("> Disclaimer: No specific securities are recommended. Educational and informational purposes only.");

  return lines.join("\n");
}

/** Compute total portfolio $ and bucket totals */
function computeTotals(positions: Position[]) {
  let total = 0;

  let equity = 0;
  let bonds = 0;
  let cash = 0;
  let other = 0;

  for (const p of positions) {
    const v = (p.currentPrice ?? p.costBasisPerUnit) * p.quantity;
    if (!Number.isFinite(v)) continue;
    total += v;

    if (isEquityLike(p.assetClass)) equity += v;
    else if (isBondLike(p.assetClass)) bonds += v;
    else if (isCashLike(p.assetClass)) cash += v;
    else other += v;
  }

  const mixDollar = { equity, bonds, cash, other };
  const mixPct = {
    equity: total > 0 ? equity / total : 0,
    bonds: total > 0 ? bonds / total : 0,
    cash: total > 0 ? cash / total : 0,
  };

  return { total, mixDollar, mixPct };
}

function buildRebalancePlan(opts: {
  total: number;
  current: { equity: number; bonds: number; cash: number; other: number };
  target: { equity: number; bonds: number; cash: number };
}) {
  const { total, current, target } = opts;

  const curPct = {
    equity: total > 0 ? current.equity / total : 0,
    bonds: total > 0 ? current.bonds / total : 0,
    cash: total > 0 ? current.cash / total : 0,
  };

  const targetDollar = {
    equity: total * target.equity,
    bonds: total * target.bonds,
    cash: total * target.cash,
  };

  const deltaDollar = {
    equity: targetDollar.equity - current.equity,
    bonds: targetDollar.bonds - current.bonds,
    cash: targetDollar.cash - current.cash,
  };

  const tableRows = [
    {
      bucket: "Equity",
      currentPct: curPct.equity,
      targetPct: target.equity,
      deltaPct: target.equity - curPct.equity,
      deltaDollar: deltaDollar.equity,
    },
    {
      bucket: "Bonds",
      currentPct: curPct.bonds,
      targetPct: target.bonds,
      deltaPct: target.bonds - curPct.bonds,
      deltaDollar: deltaDollar.bonds,
    },
    {
      bucket: "Cash/MM",
      currentPct: curPct.cash,
      targetPct: target.cash,
      deltaPct: target.cash - curPct.cash,
      deltaDollar: deltaDollar.cash,
    },
  ];

  const actions: string[] = [];

  // If close already, prefer contributions
  const maxAbsDeltaPct = Math.max(...tableRows.map((r) => Math.abs(r.deltaPct)));
  if (maxAbsDeltaPct < 0.03) {
    return { tableRows, actions, primaryFundingSource: "contributions" as const };
  }

  // Overweight cash -> move from cash to deficits
  if (deltaDollar.cash < 0) {
    const availableFromCash = Math.abs(deltaDollar.cash);

    const deficits = [
      { bucket: "Equity", need: Math.max(deltaDollar.equity, 0) },
      { bucket: "Bonds", need: Math.max(deltaDollar.bonds, 0) },
    ].filter((d) => d.need > 50); // ignore tiny moves

    if (deficits.length) {
      let remaining = availableFromCash;
      for (const d of deficits) {
        const amt = Math.min(remaining, d.need);
        if (amt <= 0) continue;
        actions.push(`- 2) Move **${money(amt)}** from **Cash/MM** → **${d.bucket}** (broad, diversified funds).`);
        remaining -= amt;
        if (remaining <= 0) break;
      }
    } else {
      actions.push(`- 2) You’re overweight Cash/MM. Consider deploying **~${money(availableFromCash)}** toward your target mix.`);
    }

    return { tableRows, actions, primaryFundingSource: "cash" as const };
  }

  // Underweight cash: suggest sell from overweights or use contributions
  if (deltaDollar.cash > 0) {
    const neededCash = deltaDollar.cash;

    const overweights = [
      { bucket: "Equity", excess: Math.max(-deltaDollar.equity, 0) },
      { bucket: "Bonds", excess: Math.max(-deltaDollar.bonds, 0) },
    ].filter((o) => o.excess > 50);

    if (overweights.length) {
      actions.push(
        `- 2) You’re under target Cash/MM by **${money(neededCash)}**. Consider directing new contributions to Cash/MM or selling small amounts of overweight buckets:`,
      );
      for (const o of overweights) {
        actions.push(`  - Sell up to **${money(Math.min(o.excess, neededCash))}** from **${o.bucket}** → **Cash/MM**`);
      }
      return { tableRows, actions, primaryFundingSource: "sell-overweights" as const };
    }

    actions.push(`- 2) Increase Cash/MM by **${money(neededCash)}** using new contributions (simplest).`);
    return { tableRows, actions, primaryFundingSource: "contributions" as const };
  }

  // Default fallback
  actions.push("- 2) Use new contributions to close allocation gaps first; sell only if you must.");
  return { tableRows, actions, primaryFundingSource: "contributions" as const };
}

function topHoldings(positions: Position[], n: number) {
  const byTicker = new Map<string, number>();
  let total = 0;

  for (const p of positions) {
    const t = (p.ticker || "").toUpperCase();
    const v = (p.currentPrice ?? p.costBasisPerUnit) * p.quantity;
    if (!t || !Number.isFinite(v)) continue;
    byTicker.set(t, (byTicker.get(t) ?? 0) + v);
    total += v;
  }

  if (total <= 0) return [];

  return Array.from(byTicker.entries())
    .map(([ticker, value]) => ({ ticker, value, weight: value / total }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
}

function concentrationWarnings(top: { ticker: string; value: number; weight: number }[]) {
  const out: string[] = [];
  if (!top.length) return out;

  const top1 = top[0];
  const top3 = top.slice(0, 3).reduce((a, b) => a + b.weight, 0);

  if (top1.weight > 0.2) out.push(`Concentration flag: **${top1.ticker}** is ${pct(top1.weight)} (common target < 20%).`);
  if (top3 > 0.6) out.push(`Concentration flag: Top 3 holdings are ${pct(top3)} (common target < 60%).`);

  // softer flag
  if (top1.weight > 0.1 && top1.weight <= 0.2) {
    out.push(`Note: Top holding is ${pct(top1.weight)} — consider keeping single names under 10–20%.`);
  }

  return out;
}

function pct(n: number) {
  return `${Math.round((n || 0) * 100)}%`;
}

function pct0(n: number) {
  return `${Math.round((n || 0) * 100)}%`;
}

function signedPct0(n: number) {
  const p = Math.round((n || 0) * 100);
  const sign = p > 0 ? "+" : "";
  return `${sign}${p}%`;
}

function money(n: number) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return `${v < 0 ? "-" : ""}$${abs}`;
}

function signedMoney(n: number) {
  const v = Number(n) || 0;
  const sign = v > 0 ? "+" : "";
  const abs = Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return `${sign}$${abs}`;
}
