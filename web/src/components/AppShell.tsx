import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowUpRight, ChevronDown, CircleHelp, Clock3, Fingerprint, Layers3, ShieldCheck, Wallet2 } from "lucide-react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { cn, shortAddress } from "@/lib/utils";
import { deployment } from "@/lib/config";

const links = [
  { to: "/", label: "Overview", icon: Layers3, end: true },
  { to: "/verify", label: "Verify", icon: Fingerprint },
  { to: "/promote", label: "Owner controls", icon: ShieldCheck },
  { to: "/releases", label: "Releases", icon: Clock3 },
];

function WalletControl() {
  const account = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [open, setOpen] = useState(false);

  if (!account.isConnected) {
    return <Button size="sm" onClick={() => { const connector = connectors[0]; if (connector) connect({ connector }); }} disabled={isPending}>
      <Wallet2 aria-hidden="true" className="size-4" /> {isPending ? "Connecting…" : "Connect wallet"}
    </Button>;
  }
  if (account.chainId !== sepolia.id) {
    return <Button size="sm" variant="secondary" onClick={() => switchChain({ chainId: sepolia.id })} disabled={isSwitching}>
      <Wallet2 aria-hidden="true" className="size-4" /> {isSwitching ? "Switching…" : "Switch to Sepolia"}
    </Button>;
  }
  const isOwner = account.address?.toLowerCase() === deployment.owner.toLowerCase();
  return <div className="relative">
      <Button variant="secondary" size="sm" aria-expanded={open} aria-controls="wallet-popover" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} onClick={() => setOpen((value) => !value)}>
      <span aria-hidden="true" className="size-2 rounded-full bg-emerald-400" />
      <span className="font-mono">{shortAddress(account.address)}</span>
      <ChevronDown aria-hidden="true" className="size-3.5 text-zinc-400" />
    </Button>
    {open && <div id="wallet-popover" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} className="absolute right-0 top-12 z-40 w-60 rounded-2xl border border-white/10 bg-[#12151c] p-2 shadow-2xl">
      <div className="px-3 py-2.5"><div className="text-xs font-medium text-zinc-200">{isOwner ? "Project owner" : "Connected wallet"}</div><div className="mt-1 truncate font-mono text-[10px] text-zinc-400">{account.address}</div></div>
      <button className="w-full rounded-xl px-3 py-2 text-left text-xs text-zinc-400 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" onClick={() => { disconnect(); setOpen(false); }}>Disconnect wallet</button>
    </div>}
  </div>;
}

export function AppShell() {
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const appBuildCid = import.meta.env.VITE_APP_BUILD_CID?.trim() || "not provided";
  return <div className="app-canvas min-h-screen text-zinc-100">
    <header className="sticky top-0 z-30 border-b border-violet-200/[0.09] bg-[#0b0b15]/75 backdrop-blur-2xl">
      <div className="mx-auto flex h-[64px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-7 lg:px-10">
        <NavLink to="/" className="group flex shrink-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" aria-label="ENSure overview">
          <div className="brand-mark relative grid size-8 place-items-center overflow-hidden rounded-[9px] border border-violet-200/20 bg-white/[0.07] text-white">
            <ShieldCheck aria-hidden="true" className="size-[18px]" />
          </div>
          <div><div className="text-[15px] font-semibold tracking-[-.04em] text-white">ENSure</div><div className="hidden text-[10px] tracking-wide text-zinc-400 sm:block">Release integrity</div></div>
        </NavLink>

        <nav aria-label="Primary navigation" className="hidden items-center gap-1 md:flex">
          {links.map(({ to, label, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("relative rounded-md px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/60", isActive ? "bg-white/[0.085] text-white after:absolute after:inset-x-3 after:-bottom-[9px] after:h-px after:bg-gradient-to-r after:from-[#b19cff] after:via-[#78e4ef] after:to-[#b4f0c6]" : "text-zinc-400 hover:bg-violet-200/[0.055] hover:text-zinc-100")}>{label}</NavLink>)}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded-md border border-emerald-200/[0.13] bg-emerald-200/[0.045] px-3 py-2 text-xs text-zinc-300 sm:flex"><span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-300" /> Sepolia</div>
          <WalletControl />
        </div>
      </div>
    </header>

    <main className="relative mx-auto min-h-[calc(100vh-145px)] w-full max-w-[1440px] px-4 pb-28 pt-8 sm:px-7 sm:pt-11 md:pb-12 lg:px-10 lg:pt-14">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={location.pathname} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -5 }} transition={{ duration: reduceMotion ? 0 : 0.24, ease: "easeOut" }}>
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </main>

    <footer className="relative border-t border-white/[0.07]">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-5 text-[10px] text-zinc-400 sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-10">
        <div className="flex items-center gap-2"><CircleHelp aria-hidden="true" className="size-3.5 text-zinc-400" /><span>A matching release proves integrity, not that the code is safe.</span></div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span className="font-mono text-zinc-400">App build · {appBuildCid}</span><a href="https://docs.ens.domains/ensv2/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-zinc-200">ENSv2 docs <ArrowUpRight aria-hidden="true" className="size-3" /></a></div>
      </div>
    </footer>

    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-white/[0.09] bg-[#080a0e]/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur-xl md:hidden">
      {links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[9px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400", isActive ? "text-blue-200" : "text-zinc-400")}>
        <Icon aria-hidden="true" className="size-[17px]" /><span className="max-w-full truncate">{label === "Owner controls" ? "Owner" : label}</span>
      </NavLink>)}
    </nav>
  </div>;
}
