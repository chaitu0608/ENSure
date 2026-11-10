import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Check, CircleDashed, ExternalLink, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Project, Receipt } from "@ensure/core/api";
import { decodeContenthash, readContenthash, sameCid } from "@ensure/core/ens";
import { CopyValue } from "@/components/CopyValue";
import { DeployStatusBadge } from "@/components/DeployStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, eventsUrl, isFinished, type DeployRow } from "@/lib/api";
import { NETWORK, deployment, publicClient, switchNetwork } from "@/lib/config";
import { cn, etherscanTx, formatDate, shortCid } from "@/lib/utils";
import { ErrorNote } from "./DeployPage";

const STAGES = ["build", "pin", "publish"] as const;
const STAGE_LABEL = { build: "Build", pin: "Pin to IPFS", publish: "Write to ENS" };

/** Replays a deploy's logs, then follows it until it ends. */
function useDeployEvents(deployId: string | undefined, onEnd: () => void) {
  const [lines, setLines] = useState<string[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    setLines([]);
    setStage(null);
    if (!deployId) return;
    const source = new EventSource(eventsUrl(deployId), { withCredentials: true });
    source.addEventListener("log", (e) => setLines((all) => [...all, JSON.parse((e as MessageEvent).data).line]));
    source.addEventListener("stage", (e) => setStage(JSON.parse((e as MessageEvent).data).stage));
    source.addEventListener("done", () => { source.close(); end.current(); });
    // The server sends "error" for a failed deploy. The browser also fires it when the connection drops, with no data.
    source.addEventListener("error", () => { source.close(); end.current(); });
    return () => source.close();
  }, [deployId]);
  return { lines, stage };
}

function Stages({ deploy, stage }: { deploy: DeployRow; stage: string | null }) {
  const done = isFinished(deploy.status);
  const current = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return <ol className="flex flex-wrap gap-2">
    {STAGES.map((s, i) => {
      const passed = deploy.status === "live" || deploy.status === "preview" || i < current;
      const active = !done && i === current;
      const failed = deploy.status === "failed" && i === current;
      return <li key={s} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium", passed ? "border-emerald-400/20 text-emerald-300" : failed ? "border-rose-400/20 text-rose-300" : active ? "border-primary/40 text-primary" : "border-border text-muted-foreground")}>
        {passed ? <Check aria-hidden="true" className="size-3" /> : failed ? <X aria-hidden="true" className="size-3" /> : active ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin" /> : <CircleDashed aria-hidden="true" className="size-3" />}
        {STAGE_LABEL[s]}
      </li>;
    })}
  </ol>;
}

function Logs({ lines }: { lines: string[] }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines.length]);
  return <pre ref={box} data-testid="deploy-logs" className="h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-background p-3.5 font-mono text-[11px] leading-5 text-foreground">{lines.length ? lines.join("\n") : "Waiting for logs…"}</pre>;
}

/** Reads the name from the chain, not from our server, so the answer doesn't depend on the receipt being honest. */
function OnChainCheck({ receipt }: { receipt: Receipt }) {
  const read = useQuery({ queryKey: ["onchain", receipt.name, receipt.txHash], queryFn: async () => decodeContenthash((await readContenthash(publicClient, receipt.name)).contenthash) });
  if (read.isLoading) return <Badge><LoaderCircle aria-hidden="true" className="size-3 animate-spin" /> Reading the chain</Badge>;
  if (read.error || !read.data) return <Badge variant="warning"><TriangleAlert aria-hidden="true" className="size-3" /> Couldn't read the chain</Badge>;
  return sameCid(read.data, receipt.siteCid)
    ? <Badge variant="success" data-testid="onchain-match"><Check aria-hidden="true" className="size-3" /> {receipt.name} serves this release</Badge>
    : <Badge variant="warning" data-testid="onchain-other"><TriangleAlert aria-hidden="true" className="size-3" /> {receipt.name} now serves {shortCid(read.data)}</Badge>;
}

function Row({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return <div className="flex items-start justify-between gap-4 text-xs"><span className="shrink-0 text-muted-foreground">{label}</span>{copy ? <CopyValue value={copy} className="min-w-0 justify-end font-mono text-[11px] text-foreground">{value}</CopyValue> : <span className="truncate font-mono text-[11px] text-foreground">{value}</span>}</div>;
}

function ReceiptCard({ receipt, project }: { receipt: Receipt; project: Project }) {
  const promotable = project.mode === "custom" && project.previewName === deployment.previewName;
  return <div className="space-y-3 rounded-xl border border-border p-4">
    <OnChainCheck receipt={receipt} />
    <div className="space-y-2">
      <Row label="ENS name" value={receipt.name} copy={receipt.name} />
      <Row label="Site CID" value={shortCid(receipt.siteCid)} copy={receipt.siteCid} />
      <Row label="Manifest CID" value={shortCid(receipt.manifestCid)} copy={receipt.manifestCid} />
      <Row label="Commit" value={receipt.commitSha.slice(0, 12)} copy={receipt.commitSha} />
      {receipt.prodWriteBlocked && <Row label="Production" value="This server can't write it" />}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm"><a href={receipt.url} target="_blank" rel="noreferrer">Open site <ArrowUpRight aria-hidden="true" className="size-3.5" /></a></Button>
      <Button asChild size="sm" variant="secondary"><a href={`/open/${encodeURIComponent(receipt.name)}`} target="_blank" rel="noreferrer">Open by ENS name <ArrowUpRight aria-hidden="true" className="size-3.5" /></a></Button>
      <Button asChild size="sm" variant="secondary"><a href={etherscanTx(receipt.txHash)} target="_blank" rel="noreferrer">Transaction <ExternalLink aria-hidden="true" className="size-3.5" /></a></Button>
      {promotable && <Button asChild size="sm" variant="secondary"><Link to="/promote"><ShieldCheck aria-hidden="true" className="size-3.5" /> Review and promote</Link></Button>}
    </div>
  </div>;
}

function DeleteProject({ project }: { project: Project }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => { client.invalidateQueries({ queryKey: ["projects"] }); navigate("/deploy"); },
  });
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Trash2 aria-hidden="true" className="size-3.5" /> Delete</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Delete this project?</DialogTitle>
        <DialogDescription>This removes the project and its deploy history from ENSure and stops auto-deploys. {project.name} keeps serving its current site.</DialogDescription>
        {remove.error && <ErrorNote message={(remove.error as Error).message} />}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete project</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

export function ProjectPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.project(id) });
  const deploys = useQuery({ queryKey: ["deploys", id], queryFn: () => api.deploys(id), refetchInterval: 5_000 });
  const [chosen, setChosen] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["deploys", id] });

  // Follows the newest deploy, so a pushed commit appears here without a click, unless an older one was picked.
  const selected = deploys.data?.find((d) => d.id === chosen) ?? deploys.data?.[0];
  const events = useDeployEvents(selected?.id, () => { void refresh(); client.invalidateQueries({ queryKey: ["onchain"] }); });

  const deploy = useMutation({ mutationFn: () => api.deploy(id), onSuccess: (d) => { setChosen(d.id); void refresh(); } });
  const rollback = useMutation({ mutationFn: (deployId: string) => api.rollback(id, deployId), onSuccess: () => client.invalidateQueries({ queryKey: ["onchain"] }) });

  if (project.isLoading) return <Skeleton className="h-64" />;
  if (project.error || !project.data) return <ErrorNote message={(project.error as Error)?.message ?? "Project not found"} />;
  const p = project.data;
  const target = p.mode === "custom" ? p.previewName! : p.name;
  if (p.network !== NETWORK) return <div className="space-y-4"><p className="text-sm text-muted-foreground">This project is on {p.network}.</p><Button variant="secondary" onClick={() => switchNetwork(p.network)}>Switch to {p.network}</Button></div>;
  const latestLive = deploys.data?.find((d) => d.status === "live");

  return <div className="space-y-6">
    <Link to="/deploy" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft aria-hidden="true" className="size-3.5" /> All projects</Link>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <Badge variant={p.mode === "custom" ? "blue" : "neutral"}>{p.mode === "custom" ? "Protected: deploys go to preview" : "Quick name: deploys go live"}</Badge>
        <p className="eyebrow mt-5">Deploy target</p><h1 className="mt-3 break-all font-mono text-[clamp(1.4rem,3vw,2.3rem)] font-normal tracking-[-.05em] text-foreground">{target}</h1>
        <p className="mt-2 text-xs text-muted-foreground"><a className="hover:text-foreground" href={p.repoUrl} target="_blank" rel="noreferrer">{p.repoUrl.replace("https://github.com/", "")}</a> · {p.branch}{p.subfolder ? ` · ${p.subfolder}` : ""}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <DeleteProject project={p} />
        <Button disabled={deploy.isPending} onClick={() => deploy.mutate()}><RefreshCw aria-hidden="true" className={cn("size-4", deploy.isPending && "animate-spin")} /> Deploy latest commit</Button>
      </div>
    </div>
    {deploy.error && <ErrorNote message={(deploy.error as Error).message} />}
    {rollback.error && <ErrorNote message={(rollback.error as Error).message} />}

    <div className="grid items-start gap-4 lg:grid-cols-[1.25fr_.75fr]">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>{selected ? `Deploy ${selected.commitSha?.slice(0, 8) ?? "(picking commit)"}` : "No deploys yet"}</CardTitle>
          {selected && <div data-testid="deploy-status"><DeployStatusBadge status={selected.status} /></div>}
        </CardHeader>
        {selected && <CardContent className="space-y-3">
          <Stages deploy={selected} stage={events.stage} />
          <Logs lines={events.lines} />
          {selected.error && <ErrorNote message={selected.error} />}
          {selected.receipt && <ReceiptCard receipt={selected.receipt} project={p} />}
        </CardContent>}
      </Card>
      <Card>
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {deploys.data?.map((d) => <div key={d.id} className={cn("flex items-center justify-between gap-2 rounded-xl border p-2.5", d.id === selected?.id ? "border-primary/40 bg-primary/[0.08]" : "border-border")}>
            <button type="button" onClick={() => setChosen(d.id)} className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="font-mono text-[11px] text-foreground">{d.commitSha?.slice(0, 8) ?? "…"}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{formatDate(d.createdAt)}</div>
            </button>
            <DeployStatusBadge status={d.status} />
            {p.mode === "quick" && d.status === "live" && d.id !== latestLive?.id && <Button variant="ghost" size="sm" disabled={rollback.isPending} onClick={() => rollback.mutate(d.id)} title="Point the name back at this release"><RotateCcw aria-hidden="true" className="size-3.5" /> Roll back</Button>}
          </div>)}
        </CardContent>
      </Card>
    </div>
  </div>;
}
