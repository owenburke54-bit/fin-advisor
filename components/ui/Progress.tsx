import * as React from "react";
import { cn } from "./cn";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number; // 0..100
}

export function Progress({ value = 0, className, ...props }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("w-full h-3 bg-gray-200 rounded-full overflow-hidden", className)}
      {...props}
    >
      <div
        className="h-full bg-black transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

