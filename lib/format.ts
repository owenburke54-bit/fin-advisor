// lib/format.ts

/* ---------- Currency ---------- */

const money0 = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const money2 = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function fmtMoney(value: number, decimals: 0 | 2 = 0): string {
  const v = Number.isFinite(value) ? value : 0;
  return decimals === 2 ? money2.format(v) : money0.format(v);
}

/* ---------- Percent ---------- */

const percent1 = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

const percent2 = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export function fmtPercent(value: number, decimals: 1 | 2 = 1): string {
  const v = Number.isFinite(value) ? value : 0;
  return decimals === 2 ? percent2.format(v) : percent1.format(v);
}

export function fmtSignedPercent(value: number, decimals: 1 | 2 = 1): string {
  const v = Number.isFinite(value) ? value : 0;
  const sign = v > 0 ? "+" : "";
  return `${sign}${fmtPercent(v, decimals)}`;
}

/* ---------- Plain Numbers (used by OverviewTab) ---------- */

export function fmtNumber(value: number, decimals = 2): string {
  const v = Number.isFinite(value) ? value : 0;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
