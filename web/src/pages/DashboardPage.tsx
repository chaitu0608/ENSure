import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Check, CircleHelp, Clock3, ExternalLink, FileCheck2, Fingerprint, TriangleAlert, X } from "lucide-react";
import { Link } from "react-router-dom";
import { SectionHeading } from "@/components/SectionHeading";
import { ReleaseFlow } from "@/components/ReleaseFlow";
import { EnvironmentCard } from "@/components/EnvironmentCard";
import { Reveal } from "@/components/Reveal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyValue } from "@/components/CopyValue";
import { StatusPill } from "@/components/StatusPill";
import { deployment } from "@/lib/config";
import { readNameSnapshot } from "@/lib/ens";
import { readReleaseHistory } from "@/lib/history";
import { verifyProject, type VerificationCheck } from "@/lib/verify";
import { formatDate, shortAddress, shortCid, etherscanTx } from "@/lib/utils";

export function DashboardPage() {
  const prod = useQuery({ queryKey: ["dashboard-prod"], queryFn: () => readNameSnapshot(deployment.prodName), refetchInterval: 60_000 });
  const preview = useQuery({ queryKey: ["dashboard-preview"], queryFn: () => readNameSnapshot(deployment.previewName), refetchInterval: 60_000 });
  const verificationQuery = useQuery({ queryKey: ["dashboard-verify"], queryFn: () => verifyProject(deployment.projectName), refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ["releases"], queryFn: () => readReleaseHistory(), refetchInterval: 60_000 });

  const latest = history.data?.rows[0];
  const verification = verificationQuery.data;
  const cid = verification?.production.cid ?? prod.data?.cid;
  const release = verification?.release;
  const approver = verification?.approver;
  const isVerified = verification?.status === "MATCH";
  const productionLoading = prod.isLoading || verificationQuery.isLoading;
  const statusCopy = productionLoading
    ? "Reading the ENS pointer, owner approval, and published files from Sepolia."
    : isVerified
    ? "The production name, owner approval, and fetched files agree."
    : verification?.status === "MISMATCH"
      ? "One or more release checks failed. Review the details before trusting this site."
      : verification?.explanation ?? "A complete release record is not available yet.";

  return <div className="space-y-8 sm:space-y-10">
    <SectionHeading eyebrow={`ENSURE · ${deployment.projectName}`} title="Know exactly what is live." description="ENSure ties a website release to its owner-approved CID, then lets anyone verify the name and files before they trust the site." action={<Button asChild><Link to="/verify"><Fingerprint aria-hidden="true" className="size-4" /> Verify a release <ArrowRight aria-hidden="true" className="size-4" /></Link></Button>} />

    {(prod.error || verificationQuery.error) && <div role="alert" className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.045] px-4 py-3 text-xs leading-5 text-amber-100/80"><TriangleAlert aria-hidden="true" className="mr-2 inline size-4" />The production data could not be fully loaded: {(verificationQuery.error ?? prod.error) instanceof Error ? (verificationQuery.error ?? prod.error)?.message : "Sepolia read failed"}</div>}

    <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
      <Reveal>
        <Card className="production-card h-full overflow-hidden">
          <div aria-hidden="true" className="production-glow" />
          <CardContent className="relative flex h-full flex-col p-5 sm:p-7 lg:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="eyebrow flex items-center gap-2"><span aria-hidden="true" className="size-1.5 rounded-full bg-blue-300" /> Production · Sepolia</div>
              <StatusPill status={productionLoading ? "LOADING" : verification?.status ?? "UNAVAILABLE"} />
            </div>
            <div className="mt-8 sm:mt-10">
              <h2 className="break-all font-mono text-[clamp(1.55rem,3vw,2.35rem)] font-medium tracking-[-.065em] text-white">{deployment.prodName}</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">{statusCopy}</p>
            </div>

            <div className="my-6 h-px bg-gradient-to-r from-blue-300/20 via-white/[0.07] to-transparent sm:my-7" />
            <div className="grid gap-5 sm:grid-cols-3 sm:gap-4">
              <Metric label="Approved release" value={release ? `#${release}` : "Not recorded"} detail={verification?.commit ? `Commit ${verification.commit.slice(0, 8)}` : "Approval record"} loading={productionLoading} />
              <div className="min-w-0"><div className="eyebrow">Site content CID</div>{productionLoading ? <Skeleton className="mt-3 h-4 w-36" /> : <CopyValue value={cid} className="mt-2 font-mono text-xs text-zinc-200">{shortCid(cid)}</CopyValue>}<div className="mt-1 text-[10px] text-zinc-400">Unique fingerprint for these files</div></div>
              <Metric label="Owner approval" value={shortAddress(approver)} detail="EIP-712 signature" loading={productionLoading} mono />
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-5 sm:mt-7">
              <Button asChild size="sm"><Link to="/verify">Open verifier <ArrowUpRight aria-hidden="true" className="size-3.5" /></Link></Button>
              <Button asChild size="sm" variant="secondary"><Link to="/promote">Owner controls</Link></Button>
              {latest?.txHash && etherscanTx(latest.txHash) && <a href={etherscanTx(latest.txHash)} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-[11px] text-zinc-400 transition-opacity hover:text-zinc-200">Latest transaction <ExternalLink aria-hidden="true" className="size-3" /></a>}
            </div>
          </CardContent>
        </Card>
      </Reveal>
      <Reveal delay={0.07}><ReleaseFlow /></Reveal>
    </div>

    <div className="grid gap-4 lg:grid-cols-[.95fr_1.05fr]">
      <Reveal delay={0.03}>
        <EnvironmentCard name={deployment.previewName} environment="Preview" snapshot={preview.data} status={preview.isLoading ? "LOADING" : preview.data?.cid ? "CANDIDATE" : "UNAVAILABLE"} loading={preview.isLoading} />
      </Reveal>
      <Reveal delay={0.08}>
        <Card className="h-full">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div><p className="eyebrow">Live integrity check</p><CardTitle className="mt-2">What we checked</CardTitle><p className="mt-1 text-xs leading-5 text-zinc-400">Read directly from ENSv2 on Sepolia and the published IPFS files.</p></div>
            <Badge variant={isVerified ? "success" : verification?.status === "MISMATCH" ? "danger" : "warning"}>{verification?.status ?? "CHECKING"}</Badge>
          </CardHeader>
          <CardContent className="pt-0">
            {verificationQuery.isLoading ? <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : verification?.checks.length ? <div className="space-y-1">{verification.checks.slice(0, 4).map((check) => <IntegrityRow key={check.id} check={check} />)}</div> : <div className="rounded-xl border border-dashed border-white/[0.09] p-4 text-xs leading-5 text-zinc-400">No checks were returned. Run the public verifier to inspect the result.</div>}
            <Link to="/verify" className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-blue-200 transition-opacity hover:text-white">See full verification <ArrowRight aria-hidden="true" className="size-3.5" /></Link>
          </CardContent>
        </Card>
      </Reveal>
    </div>

    <Reveal>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 border-b border-white/[0.055]">
          <div><p className="eyebrow">On-chain history</p><CardTitle className="mt-2">Recent production releases</CardTitle><p className="mt-1 text-xs text-zinc-400">Reconstructed from production resolver and controller events.</p></div>
          <Button asChild size="sm" variant="ghost"><Link to="/releases">View all <ArrowUpRight aria-hidden="true" className="size-3.5" /></Link></Button>
        </CardHeader>
        <CardContent className="pt-4">
          {history.isLoading ? <div className="space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : history.error ? <div role="alert" className="rounded-xl border border-amber-300/10 bg-amber-300/[0.025] p-4 text-xs leading-5 text-amber-100/70">Release events could not be read: {history.error instanceof Error ? history.error.message : "Sepolia log read failed"}</div> : latest ? <div className="release-event-row flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.018] p-4 sm:flex-row sm:items-center">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-blue-300/10 bg-blue-300/[0.055] text-blue-200"><FileCheck2 aria-hidden="true" className="size-[18px]" /></div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-zinc-200">{latest.kind === "rollback" ? "Rollback" : latest.kind === "recovered" ? "Recovery" : `Release ${latest.release ? `#${latest.release}` : "promoted"}`}</span><span className="text-[11px] text-zinc-400">{formatDate(latest.timestamp)}</span></div><div className="mt-1 truncate font-mono text-[11px] text-zinc-400">{latest.cid ? shortCid(latest.cid) : "Content CID unavailable"}{latest.commit ? ` · ${latest.commit.slice(0, 10)}` : ""}</div></div>
            {latest.approver && <span className="font-mono text-[10px] text-zinc-400">{shortAddress(latest.approver)}</span>}
            {latest.txHash && etherscanTx(latest.txHash) && <a aria-label="Open latest release transaction on Etherscan" href={etherscanTx(latest.txHash)} target="_blank" rel="noreferrer" className="grid size-9 shrink-0 place-items-center rounded-xl text-zinc-400 transition-opacity hover:bg-white/[0.05] hover:text-white"><ExternalLink aria-hidden="true" className="size-4" /></a>}
          </div> : <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-white/[0.09] p-5 sm:flex-row sm:items-center"><Clock3 aria-hidden="true" className="size-4 text-zinc-400" /><div><p className="text-xs font-medium text-zinc-300">No production release events found</p><p className="mt-1 text-[11px] leading-5 text-zinc-400">{history.data?.note ?? "This list only shows releases found in Sepolia logs. It does not invent placeholder history."}</p></div></div>}
          {history.data?.source && <p className="mt-3 text-[10px] text-zinc-400">Event source: {history.data.source}</p>}
        </CardContent>
      </Card>
    </Reveal>

    <div className="flex flex-col gap-2 rounded-2xl border border-amber-300/[0.09] bg-amber-300/[0.025] px-4 py-3 text-[11px] leading-5 text-amber-100/60 sm:flex-row sm:items-center"><TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-amber-200/70" /><span>ENSure confirms that a site matches its approved build. It cannot determine whether the approved code itself is safe.</span><a href="https://docs.ens.domains/ensv2/" target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-amber-100/75 transition-opacity hover:text-white">About ENSv2 <ArrowUpRight aria-hidden="true" className="size-3" /></a></div>
  </div>;
}

function Metric({ label, value, detail, loading, mono }: { label: string; value: string; detail: string; loading: boolean; mono?: boolean }) {
  return <div className="min-w-0"><div className="eyebrow">{label}</div>{loading ? <Skeleton className="mt-3 h-4 w-32" /> : <div className={`mt-2 truncate text-sm font-medium text-zinc-200 ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</div>}<div className="mt-1 truncate text-[10px] text-zinc-400">{detail}</div></div>;
}

function IntegrityRow({ check }: { check: VerificationCheck }) {
  const passed = check.state === "pass";
  const failed = check.state === "fail";
  const Icon = passed ? Check : failed ? X : CircleHelp;
  const stateLabel = passed ? "Passed" : failed ? "Failed" : check.state === "info" ? "Info" : "Unavailable";
  const stateClass = passed ? "text-emerald-200" : failed ? "text-rose-200" : "text-amber-100/75";
  return <div className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-opacity hover:bg-white/[0.025]">
    <div className={`mt-px grid size-6 shrink-0 place-items-center rounded-lg ${passed ? "bg-emerald-400/[0.08] text-emerald-200" : failed ? "bg-rose-400/[0.08] text-rose-200" : "bg-white/[0.05] text-zinc-400"}`}><Icon aria-hidden="true" className="size-3.5" /></div>
    <div className="min-w-0 flex-1"><div className="text-xs font-medium text-zinc-200">{check.label}</div><div className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-400">{check.detail}</div></div>
    <span className={`shrink-0 pt-0.5 text-[9px] uppercase tracking-[.12em] ${stateClass}`}>{stateLabel}</span>
  </div>;
}
