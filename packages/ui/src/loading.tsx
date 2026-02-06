import React from "react";
import { cn } from "./utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-spin rounded-full border-2 border-slate-700 border-t-emerald-500 h-6 w-6",
        className
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-slate-800",
        className
      )}
    />
  );
}
