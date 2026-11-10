import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowUpRight, ChevronDown, CircleHelp, Clock3, Fingerprint, Layers3, Menu, Rocket, Settings2, ShieldCheck, TriangleAlert, Wallet2, X } from "lucide-react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { readCurrentProjectOwner } from "@/lib/verify";
import { Button } from "@/components/ui/button";
import { cn, shortAddress } from "@/lib/utils";
import { NETWORK_NAME, activeChain, deployment, isMainnet, projectReady } from "@/lib/config";
import { NetworkSwitch } from "@/components/NetworkSwitch";

const links = [
  { to: "/", label: "Overview", icon: Layers3, end: true },
  { to: "/deploy", label: "Deploy", icon: Rocket },
  { to: "/verify", label: "Verify", icon: Fingerprint },
  { to: "/promote", label: "Owner controls", icon: ShieldCheck },
  { to: "/releases", label: "Releases", icon: Clock3 },
  { to: "/setup", label: "Setup", icon: Settings2 },
];

function WalletControl() {
  const account = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const owner = useQuery({ queryKey: ["project-owner"], queryFn: () => readCurrentProjectOwner(), enabled: projectReady, refetchInterval: 30_000 });

  if (!account.isConnected) {
    return <Button size="sm" onClick={() => { const connector = connectors[0]; if (connector) connect({ connector }); }} disabled={isPending}>
      <Wallet2 aria-hidden="true" className="size-4" /> {isPending ? "Connecting…" : "Connect wallet"}
    </Button>;
  }
  if (account.chainId !== activeChain.id) {
    return <Button size="sm" variant="secondary" onClick={() => switchChain({ chainId: activeChain.id })} disabled={isSwitching}>
      <Wallet2 aria-hidden="true" className="size-4" /> {isSwitching ? "Switching…" : `Switch to ${NETWORK_NAME}`}
    </Button>;
  }
  const me = account.address?.toLowerCase();
  const roles = [owner.data && me === owner.data.toLowerCase() && "Owner", projectReady && me === deployment.ci.toLowerCase() && "Publisher"].filter(Boolean) as string[];
  const roleLabel = !projectReady ? "No project on this network" : owner.isLoading ? "Checking role…" : roles.length ? roles.join(" + ") : "No role on this project";
  return <div className="relative">
      <Button variant="secondary" size="sm" aria-expanded={open} aria-controls="wallet-popover" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} onClick={() => setOpen((value) => !value)}>
      <span aria-hidden="true" className={cn("size-2 rounded-full", roles.length ? "bg-emerald-300" : "bg-foreground/40")} />
      <span className="wallet-role" data-testid="wallet-role">{roles.length ? roles.join(" + ") : "No role"}</span>
      <span className="font-mono">{shortAddress(account.address)}</span>
      <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
    </Button>
    {open && <div id="wallet-popover" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} className="absolute right-0 top-12 z-40 w-60 rounded-2xl border border-foreground/10 bg-card p-2 shadow-2xl">
      <div className="px-3 py-2.5"><div className="text-xs font-medium text-foreground">{roleLabel}</div><div className="mt-1 text-[10px] text-muted-foreground">{projectReady ? deployment.projectName : NETWORK_NAME}</div><div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{account.address}</div></div>
      <button className="w-full rounded-xl px-3 py-2 text-left text-xs text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { disconnect(); setOpen(false); }}>Disconnect wallet</button>
    </div>}
  </div>;
}

export function AppShell() {
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const landing = location.pathname === "/";
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  const appBuildCid = import.meta.env.VITE_APP_BUILD_CID?.trim() || "not provided";
  return <div className={`app-canvas min-h-screen text-foreground ${landing ? "landing-shell" : ""}`}>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="site-header sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex h-[64px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-7 lg:px-10">
        <NavLink to="/" onClick={() => { if (landing) window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }); }} className="group flex shrink-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="ENSure overview">
          <img src="/ensure-mark.svg" alt="" width="36" height="36" className="ensure-brand-symbol" />
          <div><div className="text-[15px] font-semibold tracking-[-.04em] text-foreground">ENSure</div><div className="hidden text-[10px] tracking-wide text-muted-foreground sm:block">Release integrity</div></div>
        </NavLink>

        <nav aria-label="Primary navigation" className="hidden items-center gap-1 md:flex">
          {landing ? <><a className="marketing-nav-link" href="#product">Product</a><a className="marketing-nav-link" href="#how-it-works">How it works</a><a className="marketing-nav-link" href="#features">Features</a><a className="marketing-nav-link" href="https://github.com/chaitu0608/ENSure#readme" target="_blank" rel="noreferrer">Documentation</a></> : links.map(({ to, label, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("relative rounded-md px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60", isActive ? "nav-active text-foreground" : "text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground")}>{label}</NavLink>)}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {landing ? <><NetworkSwitch /><Link className="header-verify" to="/verify">Verify</Link><Button asChild size="sm"><Link to="/deploy">Launch App <ArrowUpRight className="size-3.5" /></Link></Button><button className="marketing-menu-button md:hidden" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-controls="marketing-mobile-nav" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} onKeyDown={event => { if (event.key === "Escape") setMenuOpen(false); }}>{menuOpen ? <X size={18} /> : <Menu size={18} />}</button></> : <><NetworkSwitch /><WalletControl /></>}
        </div>
      </div>
      {landing && menuOpen && <nav id="marketing-mobile-nav" aria-label="Landing page sections" className="marketing-mobile-nav md:hidden" onKeyDown={event => { if (event.key === "Escape") setMenuOpen(false); }}><a href="#product" onClick={() => setMenuOpen(false)}>Product</a><a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a><a href="#features" onClick={() => setMenuOpen(false)}>Features</a><a href="#verification" onClick={() => setMenuOpen(false)}>Try verification</a><a href="https://github.com/chaitu0608/ENSure#readme" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>Documentation ↗</a></nav>}
      {isMainnet && <p className="mainnet-bar" role="status" data-testid="mainnet-bar"><TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" /> Mainnet: every transaction here spends real ETH.</p>}
    </header>

    <main id="main-content" className={landing ? "landing-main" : "relative mx-auto min-h-[calc(100vh-145px)] w-full max-w-[1440px] px-4 pb-28 pt-8 sm:px-7 sm:pt-11 md:pb-12 lg:px-10 lg:pt-14"}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={location.pathname} initial={reduceMotion || landing ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion || landing ? undefined : { opacity: 0, y: -5 }} transition={{ duration: reduceMotion ? 0 : 0.24, ease: "easeOut" }}>
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </main>

    {!landing && <footer className="relative border-t border-foreground/[0.07]">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-5 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-10">
        <div className="flex items-center gap-2"><CircleHelp aria-hidden="true" className="size-3.5 text-muted-foreground" /><span>A matching release proves integrity, not that the code is safe.</span></div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span className="font-mono text-muted-foreground">App build · {appBuildCid}</span><a href="https://docs.ens.domains/ensv2/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">ENSv2 docs <ArrowUpRight aria-hidden="true" className="size-3" /></a></div>
      </div>
    </footer>}

    {!landing && <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-foreground/[0.09] bg-background/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur-xl md:hidden">
      {links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[9px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60", isActive ? "text-foreground" : "text-muted-foreground")}>
        <Icon aria-hidden="true" className="size-[17px]" /><span className="max-w-full truncate">{label === "Owner controls" ? "Owner" : label}</span>
      </NavLink>)}
    </nav>}
  </div>;
}
