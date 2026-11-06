import { motion, useReducedMotion } from "framer-motion";
import { ArrowDown, Check, Code2, Fingerprint, Globe2, HardDrive } from "lucide-react";

const steps = [
  { label: "Source", detail: "A commit starts the build", icon: Code2 },
  { label: "Artifact", detail: "IPFS assigns a content CID", icon: HardDrive },
  { label: "Approval", detail: "The owner signs that release", icon: Fingerprint },
  { label: "ENS name", detail: "The resolver points to it", icon: Globe2 },
];

export function ReleaseFlow() {
  const reduceMotion = useReducedMotion();
  return <div className="release-flow relative h-full overflow-hidden rounded-[26px] border border-white/[0.075] bg-[#0d1016] p-5 sm:p-6">
    <div aria-hidden="true" className="absolute -right-20 -top-24 size-56 rounded-full bg-blue-500/[0.06] blur-3xl" />
    <div className="relative">
      <div className="flex items-start justify-between gap-3">
        <div><p className="eyebrow">The release path</p><h2 className="mt-2 text-lg font-semibold tracking-[-.035em] text-zinc-100">One name. One approved build.</h2></div>
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-blue-300/15 bg-blue-300/[0.07] text-blue-200"><Check aria-hidden="true" className="size-4" /></div>
      </div>
      <p className="mt-2 max-w-sm text-xs leading-5 text-zinc-400">Every release is content-addressed, signed by the owner, and discoverable through ENS.</p>

      <div className="relative mt-6 space-y-1">
        <div aria-hidden="true" className="absolute bottom-7 left-[17px] top-7 w-px bg-gradient-to-b from-blue-300/25 via-blue-300/15 to-transparent" />
        {!reduceMotion && <motion.div aria-hidden="true" className="absolute left-[14px] top-7 z-10 size-[7px] rounded-full bg-blue-200 shadow-[0_0_14px_rgba(122,180,255,.85)]" animate={{ y: [0, 126, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }} />}
        {steps.map(({ label, detail, icon: Icon }, index) => <div key={label} className="relative flex min-h-[52px] items-center gap-3 rounded-xl px-1 py-2">
          <div className="relative z-[1] grid size-[35px] shrink-0 place-items-center rounded-xl border border-white/[0.09] bg-[#0d1016] text-blue-200/80"><Icon aria-hidden="true" className="size-4" /></div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3"><div className="text-xs font-medium text-zinc-200">{label}</div><div className="truncate text-right text-[10px] text-zinc-400 sm:text-[11px]">{detail}</div></div>
          {index < steps.length - 1 && <ArrowDown aria-hidden="true" className="absolute -bottom-2 left-[13px] z-[1] size-2.5 text-blue-200/30" />}
        </div>)}
      </div>
      <div className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[11px] leading-5 text-zinc-400">The CID identifies the exact files. The ENS record makes that release easy to find.</div>
    </div>
  </div>;
}
