export function fmtMoney(n: number, decimals: number = 2) {
    const v = Number(n);
    return (Number.isFinite(v) ? v : 0).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  
  export function fmtNumber(n: number, decimals: number = 2) {
    const v = Number(n);
    return (Number.isFinite(v) ? v : 0).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  
  export function fmtPct(p: number, decimals: number = 2) {
    const v = Number(p);
    const safe = Number.isFinite(v) ? v : 0;
    return `${safe.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}%`;
  }
  