"use client";

import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        running: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25",
        stopped: "bg-slate-500/15 text-slate-400 border border-slate-500/25",
        error: "bg-red-500/15 text-red-400 border border-red-500/25",
        idle: "bg-amber-500/15 text-amber-400 border border-amber-500/25",
        info: "bg-blue-500/15 text-blue-400 border border-blue-500/25",
        success: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25",
        warning: "bg-amber-500/15 text-amber-400 border border-amber-500/25",
        danger: "bg-red-500/15 text-red-400 border border-red-500/25",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  className?: string;
  dot?: boolean;
}

export function Badge({ children, variant, className, dot = false }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)}>
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", {
            "bg-emerald-400": variant === "running" || variant === "success",
            "bg-slate-400": variant === "stopped",
            "bg-red-400": variant === "error" || variant === "danger",
            "bg-amber-400": variant === "idle" || variant === "warning",
            "bg-blue-400": variant === "info",
          })}
        />
      )}
      {children}
    </span>
  );
}

export { badgeVariants };
