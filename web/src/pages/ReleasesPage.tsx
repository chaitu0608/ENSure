import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock3, ExternalLink, FileCode2, LoaderCircle, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeading } from "@/components/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { deployment } from "@/lib/config";
import { readReleaseHistory, type ReleaseRow } from "@/lib/history";
import { formatDate, shortAddress, shortCid, etherscanTx } from "@/lib/utils";

export function ReleasesPage() {
  const history = useQuery({ queryKey: ["releases"], queryFn: readReleaseHistory, refetchInterval: 60_000 });
  return <div>
    <Reveal><SectionHeading eyebrow="Sepolia contract events" title="Release history, recorded on-chain." description="Each row is reconstructed from ENS resolver or release-controller events. There is no hard-coded release list and no server history feed." action={<Badge variant="blue"><span className="size-1.5 rounded-full bg-blue-300" /> {deployment.projectName}</Badge>} /></Reveal>
    <Reveal delay={0.04}><Card>
      <CardHeader className="flex-row items-start justify-between border-b border-white/[0.055]">
        <div><CardTitle>Production release records</CardTitle><p className="mt-1 text-xs text-zinc-400">Newest first · {history.data?.source ?? "Reading Sepolia events"}</p></div>
        {history.isFetching && <LoaderCircle className="mt-1 size-4 animate-spin text-zinc-400" />}
      </CardHeader>
      <CardContent className="p-0">
        {history.isLoading ? <div className="flex items-center gap-3 p-6 text-xs text-zinc-400"><LoaderCircle className="size-4 animate-spin" /> Reading production resolver logs…</div> : history.error ? <div role="alert" className="p-6 text-xs leading-5 text-rose-200/70">{history.error instanceof Error ? history.error.message : "Could not read Sepolia release events"}</div> : history.data?.rows.length ? <>
          <div className="hidden grid-cols-[.8fr_1.2fr_1.2fr_.8fr_.65fr] gap-4 border-b border-white/[0.045] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.14em] text-zinc-400 lg:grid"><span>Release</span><span>Site CID / commit</span><span>Build manifest</span><span>Owner / time</span><span className="text-right">Chain record</span></div>
          <div className="divide-y divide-white/[0.045]">{history.data.rows.map((row) => <ReleaseItem key={row.id} row={row} />)}</div>
        </> : <div className="px-5 py-14 text-center"><div className="mx-auto grid size-11 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-zinc-400"><Clock3 className="size-5" /></div><h2 className="mt-4 text-sm font-semibold text-zinc-300">No release events found</h2><p className="mx-auto mt-2 max-w-lg text-xs leading-6 text-zinc-400">{history.data?.note ?? "This page only displays release records reconstructed from Sepolia logs. It does not create placeholder history."}</p></div>}
      </CardContent>
    </Card></Reveal>
    <Reveal delay={0.08}><div className="mt-5 grid gap-4 md:grid-cols-2">
      <Card><CardContent className="flex gap-3 p-4"><div className="mt-0.5 text-blue-300"><ShieldCheck className="size-4" /></div><div><div className="text-xs font-medium text-zinc-300">Event-sourced release timeline</div><p className="mt-1 text-[11px] leading-5 text-zinc-400">Resolver text-record events carry the signed approval. The event transaction, block timestamp and approval bytes determine the visible history.</p></div></CardContent></Card>
      <Card><CardContent className="flex gap-3 p-4"><div className="mt-0.5 text-blue-300"><FileCode2 className="size-4" /></div><div><div className="text-xs font-medium text-zinc-300">Restore a release</div><p className="mt-1 text-[11px] leading-5 text-zinc-400">The current owner can create a fresh approval for a previously indexed release from the <Link to="/promote" className="text-blue-300 hover:text-blue-200">owner page</Link>.</p></div></CardContent></Card>
    </div></Reveal>
  </div>;
}

function ReleaseItem({ row }: { row: ReleaseRow }) {
  const type = row.kind === "rollback" ? "Rollback" : row.kind === "recovered" ? "Recovery" : "Promoted";
  return <div className="grid gap-3 px-5 py-4 lg:grid-cols-[.8fr_1.2fr_1.2fr_.8fr_.65fr] lg:items-center lg:gap-4">
    <div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xs font-medium text-zinc-200">{row.release && !row.release.startsWith("0x") ? `Release #${row.release}` : type}</span><Badge variant={row.kind === "rollback" ? "warning" : "neutral"}>{type}</Badge></div><div className="mt-1 truncate font-mono text-[10px] text-zinc-400">Block {row.block?.toString() ?? "unknown"}</div></div>
    <div className="min-w-0"><div className="text-[10px] uppercase text-zinc-400 lg:hidden">Site CID / commit</div><div className="font-mono text-[10px] text-zinc-300" title={row.cid}>{row.cid ? shortCid(row.cid) : "Not recorded"}</div><div className="mt-1 truncate font-mono text-[10px] text-zinc-400" title={row.commit}>{row.commit ? row.commit.slice(0, 16) : "Commit digest unavailable"}</div></div>
    <div className="min-w-0"><div className="text-[10px] uppercase text-zinc-400 lg:hidden">Build manifest</div><div className="font-mono text-[10px] text-zinc-400" title={row.buildManifestCid}>{row.buildManifestCid ? shortCid(row.buildManifestCid) : "Not included in this event"}</div><div className="mt-1 font-mono text-[10px] text-zinc-400" title={row.manifestCid}>Approval {row.manifestCid ? shortCid(row.manifestCid) : "unavailable"}</div></div>
    <div className="text-[10px] text-zinc-400"><span className="mr-1 text-zinc-400 lg:hidden">Owner / time</span>{shortAddress(row.approver)}<div className="mt-1 text-zinc-400">{formatDate(row.timestamp)}</div></div>
    <div className="flex items-center justify-start gap-2 lg:justify-end">
      {row.txHash && etherscanTx(row.txHash) ? <a href={etherscanTx(row.txHash)} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-blue-300" aria-label="View transaction"><ExternalLink className="size-4" /></a> : <span className="px-2 text-[10px] text-zinc-400">No tx</span>}
      {row.cid && <a href={`https://ipfs.io/ipfs/${encodeURIComponent(row.cid)}/`} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-blue-300" aria-label="Open release on IPFS"><ArrowUpRight className="size-4" /></a>}
    </div>
  </div>;
}
