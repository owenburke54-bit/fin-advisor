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
import { valueForPosition } from "@/lib/portfolioStorage";

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
  diversificationDetails?: DiversificationDetails;
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

  // profile field compat (so this route won’t break if names differ)
  const horizon =
    (profile as any).investmentHorizonYears ??
    (profile as any).horizonYears ??
    (profile as any).horizon ??
    20;

  const goal =
    (profile as any).primaryGoal ??
    (profile as any).goal ??
    "Wealth Building";

  const tier = diversificationDetails?.tier ?? "—";

  const topHoldPct =
    typeof diversificationDetails?.topHoldingPct === "number"
      ? diversificationDetails.topHoldingPct
      : top[0]?.weight ?? 0;

  const top3Pct =
    typeof diversificationDetails?.top3Pct === "number"
      ? diversificationDetails.top3Pct
      : top.slice(0, 3).reduce((a, b) => a + b.weight, 0);

  const label = portfolioLabel({ mix, diversificationScore, top1: topHoldPct });

  const lines: string[] = [];

  lines.push("# AI Portfolio Insights");
  lines.push("> Educational only. Not financial advice.");
  lines.push("");

  // ---- Snapshot (tight + premium) ----
  lines.push("## Snapshot");
  lines.push(
    `- Portfolio DNA: **${label}** • Risk **${profile.riskLevel}/5** • Horizon **${horizon}y** • Goal **${goal}**`,
  );
  lines.push(
    `- Mix now: **Equity ${pct(mix.equity)} / Bonds ${pct(mix.bonds)} / Cash-MM ${pct(mix.cash)}**`,
  );
  lines.push(
    `- Target mix: **Equity ${pct(target.equity)} / Bonds ${pct(target.bonds)} / Cash-MM ${pct(target.cash)}**`,
  );

  if (snapshot) {
    const plPct =
      typeof snapshot.totalGainLossPercent === "number" && Number.isFinite(snapshot.totalGainLossPercent)
        ? snapshot.totalGainLossPercent
        : 0;

    lines.push(
      `- Value: **${money(snapshot.totalValue)}** • P/L: **${money(snapshot.totalGainLossDollar)}** (${plPct.toFixed(2)}%)`,
    );
  } else {
    lines.push(`- Value: **${money(totals.total)}**`);
  }

  lines.push("");

  // ---- Signals (short, unique, not bland) ----
  lines.push("## Signals (what stands out)");
  lines.push(`- Diversification: **${diversificationScore}/100** (${tier})`);
  if (top.length) {
    lines.push(`- Concentration: top holding **${top[0]?.ticker ?? "—"}** at **${pct(topHoldPct)}** • top 3 at **${pct(top3Pct)}**`);
  }

  const drift = driftSummary(mix, target);
  lines.push(`- Biggest drift: **${drift.bucket}** (${drift.summary})`);

  // Keep warnings concise
  if (concWarnings.length) {
    for (const w of concWarnings.slice(0, 2)) lines.push(`- ${w}`);
  }

  lines.push("");

  // ---- Next best actions (fast + actionable) ----
  lines.push("## Next best actions (3 moves)");
  lines.push(
    `- 1) ${hasRoth
      ? "Rebalance inside your **Roth IRA** first (often avoids taxes), then adjust taxable if needed."
      : "Rebalance in the lowest-tax-impact accounts first (retirement if applicable), then taxable if needed."
    }`,
  );

  const action2 = rebalance.actions.find((a) => a.startsWith("- 2)"));
  if (action2) {
    lines.push(action2);
  } else {
    // fallback: still useful
    lines.push("- 2) Use new contributions to close the largest gap first (usually simplest + tax-friendly).");
  }

  // a “discipline rule” that feels like a real advisor
  lines.push(
    `- 3) Set a rule: rebalance when a bucket drifts **~5–10%** from target (or quarterly), and keep single-name exposure intentional.`,
  );

  lines.push("");

  // ---- Rebalance table (still valuable, keep it) ----
  lines.push("## Rebalance Table (bucket-level)");
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

  // ---- Implementation (short, but “smart”) ----
  lines.push("## Implementation (clean + realistic)");
  if (rebalance.primaryFundingSource === "cash") {
    lines.push(
      `- You’re funding from **Cash/MM** → deploy gradually (e.g., monthly) into diversified buckets that are underweight.`,
    );
  } else if (rebalance.primaryFundingSource === "sell-overweights") {
    lines.push(
      `- Cash/MM is under target → prioritize **new contributions** first; only sell overweights if you must.`,
    );
  } else {
    lines.push(`- Best default: use **new money** to close gaps (simpler + often more tax-friendly).`);
  }

  // optional: a tiny “examples” line, without being long
  lines.push("- Examples (not recommendations): equity index funds, broad bond funds, and money market for cash needs.");

  lines.push("");
  lines.push("> Disclaimer: No specific securities are recommended. Educational and informational purposes only.");

  return lines.join("\n");
}

/** Compute total portfolio $ and bucket totals (✅ uses valueForPosition) */
function computeTotals(positions: Position[]) {
  let total = 0;

  let equity = 0;
  let bonds = 0;
  let cash = 0;
  let other = 0;

  for (const p of positions) {
    const v = valueForPosition(p);
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
    ].filter((d) => d.need > 50);

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
        `- 2) You’re under target Cash/MM by **${money(neededCash)}**. Prefer new contributions, or sell small amounts of overweights:`,
      );
      for (const o of overweights) {
        actions.push(`  - Sell up to **${money(Math.min(o.excess, neededCash))}** from **${o.bucket}** → **Cash/MM**`);
      }
      return { tableRows, actions, primaryFundingSource: "sell-overweights" as const };
    }

    actions.push(`- 2) Increase Cash/MM by **${money(neededCash)}** using new contributions (simplest).`);
    return { tableRows, actions, primaryFundingSource: "contributions" as const };
  }

  actions.push("- 2) Use new contributions to close allocation gaps first; sell only if you must.");
  return { tableRows, actions, primaryFundingSource: "contributions" as const };
}

/** ✅ uses valueForPosition so Cash/MM + mixed pricing is correct */
function topHoldings(positions: Position[], n: number) {
  const byTicker = new Map<string, number>();
  let total = 0;

  for (const p of positions) {
    const t = (p.ticker || "").toUpperCase();
    const v = valueForPosition(p);
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

  if (top1.weight > 0.1 && top1.weight <= 0.2) {
    out.push(`Note: Top holding is ${pct(top1.weight)} — consider keeping single names under 10–20%.`);
  }

  return out;
}

/** Small “advisor-ish” label that feels unique */
function portfolioLabel(opts: { mix: { equity: number; bonds: number; cash: number }; diversificationScore: number; top1: number }) {
  const { mix, diversificationScore, top1 } = opts;
  if (mix.cash >= 0.35) return "Cash-Heavy Builder";
  if (top1 >= 0.2) return "Concentration Tilt";
  if (diversificationScore >= 85) return "Balanced Operator";
  if (mix.equity >= 0.8) return "High-Equity Accelerator";
  return "Steady Builder";
}

function driftSummary(
  mix: { equity: number; bonds: number; cash: number },
  target: { equity: number; bonds: number; cash: number },
) {
  const deltas = [
    { bucket: "Equity", d: mix.equity - target.equity },
    { bucket: "Bonds", d: mix.bonds - target.bonds },
    { bucket: "Cash/MM", d: mix.cash - target.cash },
  ].sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  const biggest = deltas[0];
  const sign = biggest.d >= 0 ? "over" : "under";
  return {
    bucket: biggest.bucket,
    summary: `${sign} by ${Math.abs(Math.round(biggest.d * 100))}%`,
  };
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
