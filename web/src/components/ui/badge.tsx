import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide", {
  variants: {
    variant: {
      neutral: "border-white/10 bg-white/[0.045] text-zinc-300",
      blue: "border-blue-400/20 bg-blue-400/[0.09] text-blue-300",
      success: "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300",
      danger: "border-rose-400/20 bg-rose-400/[0.08] text-rose-300",
      warning: "border-amber-300/20 bg-amber-300/[0.08] text-amber-200",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
