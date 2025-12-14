import * as React from "react";
import { cn } from "./cn";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variant === "default" ? "bg-black text-white" : "bg-gray-100 text-gray-800",
        className,
      )}
      {...props}
    />
  );
}

