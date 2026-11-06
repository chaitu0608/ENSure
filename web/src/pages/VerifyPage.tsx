import { useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, Check, CircleHelp, ExternalLink, Fingerprint, LoaderCircle, Search, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { deployment } from "@/lib/config";
import { verifyProject, type Verification, type VerificationCheck } from "@/lib/verify";
import { shortAddress, shortCid, formatDate } from "@/lib/utils";

const stateIcon = {
  pass: Check,
  fail: X,
  unavailable: CircleHelp,
  info: CircleHelp,
} as const;

export function VerifyPage() {
  const reduceMotion = useReducedMotion();
  const [name, setName] = useState(deployment.projectName);
  const [checks, setChecks] = useState<VerificationCheck[]>([]);
  const [result, setResult] = useState<Verification>();
  const [requestError, setRequestError] = useState<string>();
  const [running, setRunning] = useState(false);
  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setResult(undefined);
    setRequestError(undefined);
    setChecks([]);
    try {
      const verified = await verifyProject(name, (check) => setChecks((current) => [...current.filter((item) => item.id !== check.id), check]));
      setResult(verified);
      setChecks(verified.checks);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Verification could not be completed.");
    } finally {
      setRunning(false);
    }
  }
  const status = result?.status;
  const isMatch = status === "MATCH";
  const isMismatch = status === "MISMATCH";

  return <div className="mx-auto max-w-[1000px]">
    <Reveal><SectionHeading eyebrow="Public verification · no wallet needed" title="Check the release before you trust the page." description="Enter the ENS parent name. ENSure reads its production and preview records, checks the current owner’s EIP-712 approval, and compares every published file with its IPFS build manifest." /></Reveal>
    <Reveal delay={0.04}><Card className="mb-5 border-white/[0.09] bg-[#0f1218]">
      <CardContent className="p-4 sm:p-5">
        <form onSubmit={(event) => void run(event)} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1"><label htmlFor="verify-ens-name" className="sr-only">ENS project name to verify</label><Search aria-hidden="true" className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><Input id="verify-ens-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={deployment.projectName} className="h-12 pl-10 font-mono text-sm" spellCheck={false} autoComplete="off" /></div>
          <Button type="submit" size="lg" disabled={running || !name.trim()} className="sm:min-w-[150px]">{running ? <><LoaderCircle className="size-4 animate-spin" /> Checking</> : <><Fingerprint className="size-4" /> Verify release</>}</Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-zinc-400"><span>Sepolia · 11155111</span><span>Parent name: {deployment.projectName}</span><span>Production and preview read live</span></div>
      </CardContent>
    </Card></Reveal>
    {requestError && <div role="alert" className="mb-5 rounded-2xl border border-rose-300/20 bg-rose-300/[0.045] px-4 py-3 text-xs leading-5 text-rose-100">Verification failed to run: {requestError}</div>}

    <AnimatePresence>
      {running && !result && <motion.div role="status" aria-live="polite" key="progress" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0 }} transition={{ duration: reduceMotion ? 0 : .25 }} className="mb-5">
        <Card><CardContent className="p-0">
          <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4"><LoaderCircle className="size-4 animate-spin text-blue-300" /><div><div className="text-sm font-semibold text-zinc-100">Reading Sepolia and checking the release</div><div className="mt-1 text-[11px] text-zinc-400">Checks appear as their live reads and IPFS fetches finish.</div></div></div>
          <div className="divide-y divide-white/[0.045]">{checks.map((check, index) => <CheckRow key={check.id} check={check} index={index} />)}</div>
        </CardContent></Card>
      </motion.div>}
    </AnimatePresence>

    <AnimatePresence mode="wait">
      {result ? <motion.div role="status" aria-live="polite" key="result" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -5 }} transition={{ duration: reduceMotion ? 0 : .25 }}>
        <div className={`mb-5 overflow-hidden rounded-2xl border ${isMatch ? "border-emerald-400/20 bg-emerald-400/[0.045]" : isMismatch ? "border-rose-400/20 bg-rose-400/[0.045]" : "border-amber-300/20 bg-amber-300/[0.04]"}`}>
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-start gap-4">
              <div className={`mt-0.5 grid size-11 shrink-0 place-items-center rounded-xl ${isMatch ? "bg-emerald-400/10 text-emerald-300" : isMismatch ? "bg-rose-400/10 text-rose-300" : "bg-amber-300/10 text-amber-200"}`}>
                {isMatch ? <ShieldCheck className="size-5" /> : isMismatch ? <AlertCircle className="size-5" /> : <CircleHelp className="size-5" />}
              </div>
              <div><div className={`text-lg font-semibold tracking-tight ${isMatch ? "text-emerald-200" : isMismatch ? "text-rose-200" : "text-amber-100"}`}>{isMatch ? "Release matches its approval" : isMismatch ? "Release does not match" : "Could not complete verification"}</div><p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">{result.explanation}</p></div>
            </div>
            <Badge variant={isMatch ? "success" : isMismatch ? "danger" : "warning"} className="self-start px-3 py-1.5 text-xs sm:self-center">{result.status}</Badge>
          </div>
          <div className="border-t border-white/[0.06] px-5 py-3 text-[11px] leading-5 text-zinc-400 sm:px-6"><TriangleAlert className="mr-1.5 inline size-3.5 text-amber-200/70" />A match means the checked pointer, approval, authority and artifact bytes agree. It does not mean the code is safe.</div>
        </div>

        <Reveal><div className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4"><div><h2 className="text-sm font-semibold text-zinc-100">Verification steps</h2><p className="mt-1 text-[11px] text-zinc-400">Each row comes from a live read or fetch.</p></div><span className="font-mono text-[10px] text-zinc-400">{checks.filter((check) => check.state === "pass").length}/{checks.length} passed</span></div>
              <div className="divide-y divide-white/[0.045]">
                {checks.map((check, index) => <CheckRow key={check.id} check={check} index={index} />)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-5 p-5 sm:p-6">
              <div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-zinc-400">Observed on ENS</p><h2 className="mt-2 font-mono text-sm text-zinc-200">{result.name}</h2></div>
              <DataLine label="Content CID" value={result.cid ? shortCid(result.cid) : "Unavailable"} mono />
              <DataLine label="Owner approval CID" value={result.approvalManifestCid ? shortCid(result.approvalManifestCid) : "Unavailable"} mono />
              <DataLine label="Build manifest CID" value={result.buildManifestCid ? shortCid(result.buildManifestCid) : "Unavailable"} mono />
              <DataLine label="Release / commit" value={result.release ? `#${result.release} · ${result.commit?.slice(0, 10) ?? "commit unavailable"}` : "Not found"} mono />
              <DataLine label="Approver" value={shortAddress(result.approver)} mono />
              <DataLine label="Approval time" value={formatDate(result.issuedAt)} />
              <DataLine label="Snapshot block" value={result.blockNumber?.toString() ?? "Unavailable"} mono />
              <DataLine label="Gateway used" value={result.gateway ? new URL(result.gateway).host : "Not fetched"} />
              {result.siteUrl && <a href={result.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200">Open verified IPFS site <ExternalLink className="size-3.5" /></a>}
              {result.buildManifestUrl && <a href={result.buildManifestUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200">Open build manifest on IPFS <ExternalLink className="size-3.5" /></a>}
              {result.approvalManifestUrl && <a href={result.approvalManifestUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200">Open approval on IPFS <ExternalLink className="size-3.5" /></a>}
              {result.blockNumber !== undefined && <a href={`https://sepolia.etherscan.io/block/${result.blockNumber}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200">View Sepolia verification block <ExternalLink className="size-3.5" /></a>}
              <a href={`https://sepolia.etherscan.io/address/${result.production.resolver ?? deployment.prodResolver}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200">View production resolver on Etherscan <ExternalLink className="size-3.5" /></a>
            </CardContent>
          </Card>
        </div></Reveal>
        <Reveal delay={0.05}><div className="mt-5 grid gap-4 md:grid-cols-2">
          <EnvironmentSummary title="Production · owner-approved" environment={result.production} primary />
          <EnvironmentSummary title="Preview · candidate build" environment={result.preview} />
        </div></Reveal>
      </motion.div> : !running ? <motion.div key="intro" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} transition={{ duration: reduceMotion ? 0 : .25 }} className="grid gap-4 md:grid-cols-3">
        {[
          ["01", "Read both environments", "Resolve production and preview contenthashes and live build-record pointers."],
          ["02", "Check owner approval", "Validate the canonical EIP-712 signature against the current ENS parent-name owner."],
          ["03", "Check every file", "Fetch the build manifest and compare each file's size and SHA-256 through IPFS gateways."],
        ].map(([step, title, detail], index) => <Reveal key={step} delay={index * .06}><Card className="h-full bg-[#0e1117]"><CardContent className="p-5"><div className="font-mono text-[10px] text-blue-200">{step}</div><div className="mt-4 text-sm font-semibold text-zinc-100">{title}</div><p className="mt-2 text-xs leading-5 text-zinc-400">{detail}</p></CardContent></Card></Reveal>)}
      </motion.div> : null}
    </AnimatePresence>
  </div>;
}

function EnvironmentSummary({ title, environment, primary }: { title: string; environment: Verification["production"]; primary?: boolean }) {
  return <Card className={primary ? "border-blue-400/[0.12]" : ""}><CardContent className="p-4 sm:p-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-xs font-semibold text-zinc-200">{title}</h2><Badge variant={environment.cid ? "blue" : "neutral"}>{environment.cid ? "Live" : "Not published"}</Badge></div>
    <p className="mt-3 truncate font-mono text-[11px] text-zinc-400" title={environment.name}>{environment.name}</p>
    <DataLine label="Content CID" value={environment.cid ? shortCid(environment.cid) : "Unavailable"} mono />
    <DataLine label="Build record" value={environment.buildRecord || "Not set"} mono />
    <p className="mt-3 text-[10px] leading-5 text-zinc-400">{environment.detail}</p>
  </CardContent></Card>;
}

function CheckRow({ check, index }: { check: VerificationCheck; index: number }) {
  const reduceMotion = useReducedMotion();
  const Icon = stateIcon[check.state];
  const tint = check.state === "pass" ? "text-emerald-300 bg-emerald-400/[0.08]" : check.state === "fail" ? "text-rose-300 bg-rose-400/[0.08]" : check.state === "unavailable" ? "text-amber-200 bg-amber-300/[0.08]" : "text-blue-200 bg-blue-300/[0.08]";
  return <motion.div initial={reduceMotion ? false : { opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reduceMotion ? 0 : Math.min(index * .055, .4), duration: reduceMotion ? 0 : .22 }} className="flex gap-3 px-5 py-3.5">
    <div className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${tint}`}><Icon className={`size-3.5 ${check.state === "pass" && index > 0 ? "animate-check-in" : ""}`} /></div>
    <div className="min-w-0"><div className="text-xs font-medium text-zinc-200">{check.label}</div><div className={`mt-1 break-words text-[11px] leading-5 ${check.state === "fail" ? "text-rose-200/80" : check.state === "unavailable" ? "text-amber-100/70" : "text-zinc-400"}`}>{check.detail}</div></div>
  </motion.div>;
}

function DataLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex items-center justify-between gap-3 border-b border-white/[0.045] pb-3"><span className="text-[11px] text-zinc-400">{label}</span><span className={`max-w-[62%] truncate text-right text-[11px] text-zinc-300 ${mono ? "font-mono" : ""}`} title={value}>{value}</span></div>;
}
