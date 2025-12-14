import * as React from "react";
import { cn } from "./cn";

export interface Tab {
  value: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
}

export function Tabs({ tabs, value, onValueChange, className }: TabsProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex gap-2 border-b border-border">
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              className={cn(
                "px-3 py-2 text-sm font-medium border-b-2 -mb-[1px]",
                active ? "border-black text-black" : "border-transparent text-gray-500 hover:text-gray-800",
              )}
              onClick={() => onValueChange(t.value)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TabPanel({
  when,
  value,
  children,
  className,
}: {
  when: string;
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (when !== value) return null;
  return <div className={cn("pt-4", className)}>{children}</div>;
}

