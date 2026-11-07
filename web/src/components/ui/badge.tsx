import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide", {
  variants: {
    variant: {
      neutral: "border-foreground/10 bg-foreground/[0.045] text-muted-foreground",
      blue: "border-foreground/20 bg-foreground/[0.09] text-muted-foreground",
      success: "border-emerald-300/30 bg-emerald-300/[0.08] text-emerald-200",
      danger: "border-rose-300/40 bg-rose-300/[0.1] text-rose-200",
      warning: "border-dashed border-amber-200/35 bg-amber-200/[0.05] text-amber-100",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
