import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileCheck2, GitBranch, Github, Globe2, LoaderCircle, LogOut, Rocket, ShieldCheck, TriangleAlert, Wallet2, Zap } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { DeployStatusBadge } from "@/components/DeployStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api, loginUrl } from "@/lib/api";
import { deployment } from "@/lib/config";
import { cn, formatDate } from "@/lib/utils";

export function ErrorNote({ message }: { message: string }) {
  return <div role="alert" className="flex gap-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-3.5 py-2.5 text-xs leading-5 text-rose-200"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{message}</div>;
}

function Login() {
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  return <Card>
    <CardHeader><CardTitle>Log in to deploy</CardTitle><CardDescription>GitHub login lists your repos. Verify and owner controls don't need a login.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {providers.error && <ErrorNote message={(providers.error as Error).message} />}
      {providers.data && !providers.data.github && !providers.data.google && <ErrorNote message="No login is configured. Set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET in .env, then restart the server." />}
      <div className="flex flex-wrap gap-2">
        {providers.data?.github && <Button asChild><a href={loginUrl("github")}><Github aria-hidden="true" className="size-4" /> Continue with GitHub</a></Button>}
        {providers.data?.google && <Button asChild variant="secondary"><a href={loginUrl("google")}>Continue with Google</a></Button>}
      </div>
    </CardContent>
  </Card>;
}

function ModeOption({ active, onClick, icon, title, detail }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; detail: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn("rounded-xl border p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-primary/40 bg-primary/[0.08]" : "border-border hover:bg-foreground/[0.04]")}>
    <div className="flex items-center gap-2 text-sm font-medium text-foreground">{icon}{title}</div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
  </button>;
}

/** The server only accepts a custom name once the wallet that owns it has signed a challenge. */
function ProveName({ name, proven, onProven }: { name: string; proven: boolean; onProven: () => void }) {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: connecting, error: connectError } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const prove = useMutation({
    mutationFn: async () => {
      const { nonce, message } = await api.challenge(name, address!);
      await api.proveName(nonce, await signMessageAsync({ message }));
    },
    onSuccess: onProven,
  });
  if (proven) return <Badge variant="success" className="w-fit"><ShieldCheck aria-hidden="true" className="size-3.5" /> Ownership proven</Badge>;
  return <div className="space-y-2">
    {isConnected
      ? <Button type="button" variant="secondary" size="sm" disabled={prove.isPending || !name} onClick={() => prove.mutate()}>{prove.isPending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <ShieldCheck aria-hidden="true" className="size-3.5" />} Sign to prove you own {name || "this name"}</Button>
      : <Button type="button" variant="secondary" size="sm" disabled={connecting} onClick={() => connectors[0] && connect({ connector: connectors[0] })}><Wallet2 aria-hidden="true" className="size-3.5" /> Connect the wallet that owns it</Button>}
    {connectError && <ErrorNote message={connectError.message} />}
    {prove.error && <ErrorNote message={(prove.error as Error).message} />}
  </div>;
}

function NewProject({ github }: { github: boolean }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const repos = useQuery({ queryKey: ["repos"], queryFn: api.repos, enabled: github });
  const [repoUrl, setRepoUrl] = useState("");
  const [picked, setPicked] = useState("");
  const [branch, setBranch] = useState("");
  const [subfolder, setSubfolder] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [mode, setMode] = useState<"quick" | "custom">("quick");
  const [name, setName] = useState(deployment.projectName);
  const [provenName, setProvenName] = useState("");
  const branches = useQuery({ queryKey: ["branches", picked], queryFn: () => api.branches(picked), enabled: Boolean(picked) });

  const create = useMutation({
    mutationFn: () => api.createProject({
      repoUrl: repoUrl.trim(), deploy: true,
      branch: branch || undefined, subfolder: subfolder.trim() || undefined, outputDir: outputDir.trim() || undefined,
      name: mode === "custom" ? name.trim() : undefined,
    }),
    onSuccess: ({ project }) => { client.invalidateQueries({ queryKey: ["projects"] }); navigate(`/deploy/${project.id}`); },
  });
  const submit = (event: FormEvent) => { event.preventDefault(); create.mutate(); };
  const needsProof = mode === "custom" && provenName !== name.trim();

  return <Card>
    <CardHeader><CardTitle>Deploy a repo</CardTitle><CardDescription>ENSure builds the repo, pins it to IPFS and points an ENS name at it. New commits on the branch deploy on their own.</CardDescription></CardHeader>
    <CardContent>
      <form onSubmit={submit} className="space-y-4">
        {github && Boolean(repos.data?.length) && <div>
          <Label htmlFor="repo-picker">Your repos</Label>
          <Select value={picked} onValueChange={(value) => { setPicked(value); setBranch(""); setRepoUrl(`https://github.com/${value}`); }}>
            <SelectTrigger id="repo-picker"><SelectValue placeholder="Pick a repo" /></SelectTrigger>
            <SelectContent>{repos.data!.map((r) => <SelectItem key={r.id} value={r.fullName}>{r.fullName}{r.private ? " (private)" : ""}</SelectItem>)}</SelectContent>
          </Select>
        </div>}
        <div>
          <Label htmlFor="repo-url">Repo URL</Label>
          <Input id="repo-url" required value={repoUrl} onChange={(e) => { setRepoUrl(e.target.value); setPicked(""); }} placeholder="https://github.com/you/site or .../tree/main/apps/web" spellCheck={false} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="branch">Branch</Label>
            {branches.data?.length
              ? <Select value={branch} onValueChange={setBranch}><SelectTrigger id="branch"><SelectValue placeholder="Default branch" /></SelectTrigger><SelectContent>{branches.data.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
              : <Input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Default branch" spellCheck={false} />}
          </div>
          <div><Label htmlFor="subfolder">Subfolder</Label><Input id="subfolder" value={subfolder} onChange={(e) => setSubfolder(e.target.value)} placeholder="Repo root" spellCheck={false} /></div>
          <div><Label htmlFor="output">Output folder</Label><Input id="output" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="Detected" spellCheck={false} /></div>
        </div>
        <div>
          <Label>ENS name</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <ModeOption active={mode === "quick"} onClick={() => setMode("quick")} icon={<Zap aria-hidden="true" className="size-4 text-primary" />} title="Quick name" detail="A generated name that goes live straight away." />
            <ModeOption active={mode === "custom"} onClick={() => setMode("custom")} icon={<ShieldCheck aria-hidden="true" className="size-4 text-primary" />} title="My ENS name" detail="Deploys go to preview. Production changes only when the owner promotes." />
          </div>
        </div>
        {mode === "custom" && <div className="space-y-2">
          <Label htmlFor="custom-name">Name you own</Label>
          <Input id="custom-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="project.eth" spellCheck={false} />
          <ProveName name={name.trim()} proven={!needsProof} onProven={() => setProvenName(name.trim())} />
        </div>}
        {create.error && <ErrorNote message={(create.error as Error).message} />}
        <Button type="submit" size="lg" disabled={create.isPending || !repoUrl.trim() || needsProof}>
          {create.isPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Rocket aria-hidden="true" className="size-4" />} Deploy
        </Button>
      </form>
    </CardContent>
  </Card>;
}

function Projects() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects, refetchInterval: 10_000 });
  if (projects.isLoading) return <Skeleton className="h-28" />;
  if (projects.error) return <ErrorNote message={(projects.error as Error).message} />;
  return <Card>
    <CardHeader><CardTitle>Projects</CardTitle></CardHeader>
    <CardContent className="space-y-2">
      {!projects.data?.length && <p className="text-xs leading-5 text-muted-foreground">Nothing deployed yet. Your first deploy shows up here.</p>}
      {projects.data?.map((p) => <Link key={p.id} to={`/deploy/${p.id}`} className="group flex items-center justify-between gap-3 rounded-xl border border-border p-3.5 hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-foreground">{p.mode === "custom" ? p.previewName : p.name}</div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">{p.repoUrl.replace("https://github.com/", "")} · {p.branch}{p.lastDeploy ? ` · ${formatDate(p.lastDeploy.createdAt)}` : ""}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">{p.lastDeploy && <DeployStatusBadge status={p.lastDeploy.status} />}<ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" /></div>
      </Link>)}
    </CardContent>
  </Card>;
}

const deploySteps = [
  { title: "Build the commit", detail: "Your repo builds in a container that holds no secrets.", icon: GitBranch },
  { title: "Pin the files", detail: "The site and its manifest go to IPFS, then get fetched back and compared.", icon: FileCheck2 },
  { title: "Write the name", detail: "A quick name goes live. Your own ENS name updates preview, then you promote it.", icon: Globe2 },
];

export function DeployPage() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => client.resetQueries({ queryKey: ["me"] }) });
  const loggedOut = me.error instanceof ApiError && me.error.status === 401;
  const unreachable = me.error instanceof ApiError && me.error.status !== 401;

  return <div className="deploy-page">
    <header className="verifier-intro">
      <div><p className="eyebrow">Deploy / IPFS + ENSv2</p><h1 className="editorial-title">Ship the repo.<br /><em>Name the <span className="word-cycle">release.</span></em></h1><p className="editorial-description">Build, pin to IPFS and publish on ENSv2, with live logs. New commits on your branch deploy on their own.</p></div>
      <div className="min-w-0">
        {me.isLoading && <Skeleton className="h-40" />}
        {unreachable && <ErrorNote message={(me.error as Error).message} />}
        {loggedOut && <Login />}
        {me.data && <div className="verify-launch deploy-account"><div className="min-w-0"><p className="eyebrow">Signed in</p><p className="mt-2 truncate font-mono text-sm">{me.data.login}</p></div><Button variant="ghost" size="sm" onClick={() => logout.mutate()}><LogOut aria-hidden="true" className="size-3.5" /> Log out</Button></div>}
      </div>
    </header>
    {me.data ? <div className="deploy-workspace">
      <NewProject github={me.data.provider === "github"} />
      <Projects />
    </div> : <section className="verification-plan" aria-labelledby="deploy-plan-title"><div><p className="eyebrow">What happens</p><h2 id="deploy-plan-title" className="mt-3 text-2xl font-medium tracking-tight">Three steps per deploy.</h2></div><ol className="verification-phases">{deploySteps.map(({ title, detail, icon: Icon }, index) => <li key={title}><span className="phase-icon"><Icon strokeWidth={1.4} aria-hidden="true" /></span><span className="eyebrow">0{index + 1}</span><h3>{title}</h3><p>{detail}</p></li>)}</ol></section>}
  </div>;
}
