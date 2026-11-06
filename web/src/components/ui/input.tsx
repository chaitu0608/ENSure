import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-400 focus:border-blue-400/50 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-50", className)} {...props} />
));
Input.displayName = "Input";
