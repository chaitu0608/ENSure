import type { ReactNode } from "react";

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-5 sm:mb-9 sm:flex-row sm:items-end">
    <div className="max-w-3xl">{eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}<h1 className="text-[clamp(2rem,4vw,3.15rem)] font-medium leading-[1.08] tracking-[-.065em] text-white">{title}</h1>{description && <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-[15px]">{description}</p>}</div>
    {action && <div className="shrink-0">{action}</div>}
  </div>;
}
