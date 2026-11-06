import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-transform active:scale-[.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "bg-blue-500 text-white shadow-[0_8px_25px_rgba(37,99,235,.22)] hover:bg-blue-400",
        secondary: "border border-white/10 bg-white/[0.055] text-zinc-100 hover:bg-white/[0.09]",
        ghost: "text-zinc-400 hover:bg-white/[0.06] hover:text-white",
        outline: "border border-white/10 bg-transparent text-zinc-300 hover:border-white/20 hover:bg-white/[0.04]",
        danger: "border border-rose-500/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-12 px-5",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
});
Button.displayName = "Button";
