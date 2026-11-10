import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, CircleAlert, LoaderCircle, LockKeyhole, Search, TriangleAlert, Wallet2 } from "lucide-react";
import { useAccount, useConnect, useSwitchChain, useWalletClient } from "wagmi";
import { formatEther, isAddress, type Address } from "viem";
import { readNameStatus, setupProject, signerFrom } from "@ensure/core/setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { NETWORK, NETWORK_NAME, activeChain, deployment, isMainnet, projectReady, publicClient } from "@/lib/config";
import { explorerAddress, shortAddress } from "@/lib/utils";

const ensApp = (name: string) => `https://${isMainnet ? "" : "sepolia."}app.ens.domains/${name}`;
// Measured on a mainnet fork against the real ENSv2 contracts. Fewer if parts of the setup already exist.
const SETUP_GAS = 1_200_000n;
const SETUP_TXS = "Up to 9";

export function SetupPage() {
  const account = useAccount();
  const { data: walletClient } = useWalletClient();
  const { connectors, connect, isPending: connecting } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [input, setInput] = useState(deployment.projectName);
  const [name, setName] = useState("");
  const [publisher, setPublisher] = useState("");
  const [steps, setSteps] = useState<string[]>([]);

  const networks = useQuery({ queryKey: ["networks"], queryFn: api.networks, retry: false });
  const serverPublisher = networks.data?.[NETWORK].publisher;
  useEffect(() => { if (serverPublisher) setPublisher((current) => current || serverPublisher); }, [serverPublisher]);

  const status = useQuery({
    queryKey: ["name-status", name],
    enabled: Boolean(name),
    queryFn: () => readNameStatus((tx) => publicClient.readContract(tx as never) as Promise<any>, activeChain.id, name),
  });
  const gasPrice = useQuery({ queryKey: ["gas-price"], queryFn: () => publicClient.getGasPrice(), refetchInterval: 30_000, enabled: Boolean(name) });
  const publisherBalance = useQuery({ queryKey: ["publisher-balance", publisher], enabled: isAddress(publisher), queryFn: () => publicClient.getBalance({ address: publisher as Address }), refetchInterval: 30_000 });

  const isOwner = Boolean(account.address && status.data && account.address.toLowerCase() === status.data.owner.toLowerCase());
  const onChain = account.chainId === activeChain.id;
  const publisherProblem = !isAddress(publisher) ? "Enter the publisher address." : account.address && publisher.toLowerCase() === account.address.toLowerCase() ? "The publisher must not be your owner wallet, or the separation of roles means nothing." : undefined;

  const run = useMutation({
    mutationFn: async () => {
      if (!walletClient || !account.address) throw new Error("Connect your wallet first");
      setSteps([]);
      const signer = signerFrom({ public: publicClient as never, wallet: walletClient as never, account: account.address });
      return setupProject(signer, name, publisher as Address, { resume: true, log: (line) => setSteps((all) => [...all, line]) });
    },
  });

  function check(event: FormEvent) {
    event.preventDefault();
    run.reset();
    setSteps([]);
    setName(input.trim().toLowerCase());
  }

  const validName = /^[a-z0-9-]+\.eth$/.test(input.trim().toLowerCase());
  const syncCommand = `corepack pnpm sync-deployment ${NETWORK} ${name} ${publisher}`;
  const estimate = gasPrice.data ? formatEther(SETUP_GAS * gasPrice.data) : undefined;

  return <div className="verifier-page">
    <header className="verifier-intro">
      <div><p className="eyebrow">Project setup / {NETWORK_NAME} ENSv2</p><h1 className="editorial-title">Your name.<br /><em>Your <span className="word-cycle">roles.</span></em></h1><p className="editorial-description">Give your ENS name separate preview and production resolvers on ENSv2. Your wallet signs every step, and the publisher only ever gets preview rights.</p></div>
      <form onSubmit={check} className="verify-launch">
        <label htmlFor="setup-name" className="mb-3 block text-sm font-medium">Which .eth name do you own?</label>
        <div className="relative"><Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="setup-name" value={input} onChange={(event) => setInput(event.target.value)} placeholder="yourname.eth" className="h-14 pl-11 font-mono text-base" spellCheck={false} autoComplete="off" /></div>
        <Button type="submit" size="lg" disabled={!validName || status.isFetching} className="mt-4 w-full">{status.isFetching ? <LoaderCircle className="size-4 animate-spin" /> : null} Check this name</Button>
        <p className="mt-5 text-xs text-muted-foreground">Checking is read-only and needs no wallet.</p>
      </form>
    </header>

    {!projectReady && !name && <p className="timeline-source" role="status">No project is set up on {NETWORK_NAME} yet, so Verify, Owner controls and Releases open here until one is.</p>}

    {status.error && <p role="alert" className="authority-error"><Badge variant="warning">UNAVAILABLE</Badge> {(status.error as Error & { shortMessage?: string }).shortMessage ?? (status.error as Error).message}</p>}

    {status.data && <section className="verification-plan" aria-labelledby="setup-result" data-testid="setup-result" data-status={status.data.status}>
      <p className="eyebrow">{name}</p>

      {status.data.status === "available" && <>
        <h2 id="setup-result" className="mt-3 text-2xl font-medium tracking-tight">Nobody owns this name yet.</h2>
        <p className="editorial-description">Register it in the ENS app, then check again.</p>
        <Button asChild className="mt-5" variant="secondary"><a href={ensApp(name)} target="_blank" rel="noreferrer">Open the ENS app <ArrowUpRight className="size-4" /></a></Button>
      </>}

      {status.data.status === "reserved" && <>
        <h2 id="setup-result" className="mt-3 text-2xl font-medium tracking-tight">This is still an ENSv1 name.</h2>
        <p className="editorial-description">ENSure only works on ENSv2, so migrate it first in the ENS app, from the wallet that owns it. Then check again. ENSure doesn't migrate names for you.</p>
        <p role="alert" className="setup-warning"><TriangleAlert aria-hidden="true" className="size-4 shrink-0" /><span><strong>Migration is one-way.</strong> A migrated name can't go back to ENSv1. Check that the wallets and apps you rely on for this name support ENSv2 before you do it.</span></p>
        <div className="mt-5 flex flex-wrap gap-2"><Button asChild variant="secondary"><a href={ensApp(name)} target="_blank" rel="noreferrer">Migrate in the ENS app <ArrowUpRight className="size-4" /></a></Button><Button variant="ghost" onClick={() => void status.refetch()}>Check again</Button></div>
      </>}

      {status.data.status === "registered" && <>
        <h2 id="setup-result" className="mt-3 text-2xl font-medium tracking-tight">{isOwner ? "On ENSv2, and it's yours." : "On ENSv2."}</h2>
        <dl className="setup-facts">
          <div><dt>Owner</dt><dd><a href={explorerAddress(status.data.owner)} target="_blank" rel="noreferrer" className="font-mono">{shortAddress(status.data.owner)}</a></dd></div>
          <div><dt>Name registry</dt><dd>{/^0x0+$/.test(status.data.subregistry) ? "None yet. Setup creates one." : <span className="font-mono">{shortAddress(status.data.subregistry)}. Setup reuses it.</span>}</dd></div>
          <div><dt>Creates</dt><dd className="font-mono">prod.{name}, preview.{name}</dd></div>
        </dl>

        {!account.isConnected ? <Button className="mt-5" variant="secondary" onClick={() => connectors[0] && connect({ connector: connectors[0] })} disabled={connecting}><Wallet2 className="size-4" /> {connecting ? "Connecting…" : "Connect the owner wallet"}</Button>
          : !onChain ? <Button className="mt-5" variant="secondary" onClick={() => switchChain({ chainId: activeChain.id })} disabled={switching}><Wallet2 className="size-4" /> Switch wallet to {NETWORK_NAME}</Button>
          : !isOwner ? <p role="alert" className="setup-warning"><CircleAlert aria-hidden="true" className="size-4 shrink-0" /><span>The connected wallet {shortAddress(account.address)} doesn't own {name}. Connect {shortAddress(status.data.owner)}.</span></p>
          : !run.isSuccess && <div className="mt-6 space-y-4">
            <div className="max-w-xl">
              <label htmlFor="setup-publisher" className="mb-2 block text-sm font-medium">Publisher address</label>
              <Input id="setup-publisher" value={publisher} onChange={(event) => setPublisher(event.target.value.trim())} placeholder="0x…" className="font-mono text-xs" spellCheck={false} autoComplete="off" />
              <p className="mt-2 text-xs leading-6 text-muted-foreground">The server key that builds will publish. It can write preview only. {isMainnet && !serverPublisher ? "Set MAINNET_PUBLISHER_PRIVATE_KEY on the server to fill this in." : ""}{publisherBalance.data !== undefined && ` Balance: ${formatEther(publisherBalance.data)} ETH.`}{isMainnet && publisherBalance.data === 0n && " It needs ETH to publish."}</p>
              {publisher && publisherProblem && <p role="alert" className="mt-2 text-xs text-rose-200">{publisherProblem}</p>}
            </div>
            <p className="text-xs leading-6 text-muted-foreground">{SETUP_TXS} wallet confirmations.{isMainnet && estimate ? ` About ${Number(estimate).toFixed(5)} ETH of real gas at today's price.` : ""}</p>
            <Button size="lg" data-testid="run-setup" onClick={() => run.mutate()} disabled={run.isPending || Boolean(publisherProblem)}>{run.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />} {run.isPending ? "Confirm each step in your wallet…" : `Set up ${name}`}</Button>
          </div>}

        {steps.length > 0 && <ol className="setup-steps" aria-label="Setup progress">{steps.map((step, index) => <li key={`${step}-${index}`}>{index === steps.length - 1 && run.isPending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Check aria-hidden="true" className="size-3.5" />}{step}</li>)}</ol>}
        {run.error && <p role="alert" className="setup-warning"><CircleAlert aria-hidden="true" className="size-4 shrink-0" /><span>{(run.error as Error & { shortMessage?: string }).shortMessage ?? run.error.message} Nothing is lost: run setup again and it continues from where it stopped.</span></p>}
        {run.isSuccess && <div className="mt-6" data-testid="setup-done">
          <p className="text-lg font-medium tracking-tight">{name} is set up. One last step.</p>
          <p className="editorial-description">Save it to this app's config so every page can read it. This reads the chain and sends nothing:</p>
          <pre className="setup-command"><code>{syncCommand}</code></pre>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">Then publish a build to preview and promote it from Owner controls.{isMainnet ? ` Your site will then open at https://prod.${name}.limo` : ""}</p>
        </div>}
      </>}
    </section>}
  </div>;
}
