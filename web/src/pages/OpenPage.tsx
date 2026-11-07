import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, LoaderCircle, Search } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { decodeContenthash, readContenthash } from "@ensure/core/ens";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { publicClient } from "@/lib/config";
import { shortCid } from "@/lib/utils";

// Browsers can't resolve .eth, and the public .eth.limo gateway doesn't read these ENSv2 names on Sepolia.
// So the app reads the contenthash from the chain itself and sends the visitor to an IPFS gateway.
const GATEWAYS = [
  { label: "Filebase", url: (cid: string) => `https://ipfs.filebase.io/ipfs/${cid}/` },
  { label: "ipfs.io", url: (cid: string) => `https://ipfs.io/ipfs/${cid}/` },
  { label: "dweb.link", url: (cid: string) => `https://dweb.link/ipfs/${cid}/` },
];

async function resolveSite(name: string) {
  const { contenthash } = await readContenthash(publicClient, name).catch((error: Error & { shortMessage?: string }) => {
    throw new Error(/revert/i.test(error.shortMessage ?? error.message) ? `${name} isn't registered on Sepolia ENSv2, or has no resolver.` : (error.shortMessage ?? error.message));
  });
  if (contenthash === "0x") throw new Error(`${name} has no site yet. Its contenthash is empty.`);
  return decodeContenthash(contenthash);
}

export function OpenPage() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(name);
  const site = useQuery({ queryKey: ["open", name], queryFn: () => resolveSite(name), enabled: Boolean(name), retry: 1 });
  const cid = site.data;

  useEffect(() => { if (cid) window.location.replace(GATEWAYS[0].url(cid)); }, [cid]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = input.trim().toLowerCase();
    if (next) navigate(`/open/${encodeURIComponent(next)}`);
  }

  return <div className="verifier-page">
    <header className="verifier-intro">
      <div><p className="eyebrow">Open an ENS website / Sepolia</p><h1 className="editorial-title">Type the name.<br /><em>Land on the <span className="word-cycle">site.</span></em></h1><p className="editorial-description">Browsers can't resolve .eth names on their own. ENSure reads the name's contenthash from Sepolia, then opens that CID on an IPFS gateway.</p></div>
      <form onSubmit={submit} className="verify-launch">
        <label htmlFor="open-name" className="mb-3 block text-sm font-medium">Which ENS name?</label>
        <div className="relative"><Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="open-name" value={input} onChange={(event) => setInput(event.target.value)} placeholder="wild-falcon-1932.walunj.eth" className="h-14 pl-11 font-mono text-base" spellCheck={false} autoComplete="off" /></div>
        <Button type="submit" size="lg" disabled={!input.trim()} className="mt-4 w-full">Open site <ArrowRight className="size-4" /></Button>
      </form>
    </header>
    {name && <section className="verification-plan" role="status" aria-live="polite" aria-labelledby="open-title">
      <p className="eyebrow">Resolving</p>
      <h2 id="open-title" className="mt-3 break-all font-mono text-2xl font-normal tracking-tight">{name}</h2>
      {site.isLoading && <p className="mt-6 flex items-center gap-3 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Reading the contenthash from Sepolia…</p>}
      {site.error && <p role="alert" className="mt-6 text-sm leading-7 text-muted-foreground"><Badge variant="warning">UNAVAILABLE</Badge> <span className="ml-2 break-words">{(site.error as Error).message}</span></p>}
      {cid && <div className="mt-6 space-y-4">
        <p className="text-sm leading-7 text-muted-foreground">Contenthash points to <span className="break-all font-mono text-foreground" title={cid}>{shortCid(cid)}</span>. Opening it now. If the page doesn't load, try another gateway:</p>
        <div className="flex flex-wrap gap-2">{GATEWAYS.map((gateway) => <Button key={gateway.label} asChild size="sm" variant="secondary"><a href={gateway.url(cid)}>{gateway.label} <ArrowUpRight aria-hidden="true" className="size-3.5" /></a></Button>)}<Button asChild size="sm" variant="ghost"><Link to="/verify">Verify a protected name</Link></Button></div>
        <p className="text-[11px] leading-5 text-muted-foreground">The gateway serves whatever the CID holds, and this page doesn't check file hashes. Verify does that for protected names.</p>
      </div>}
    </section>}
  </div>;
}
