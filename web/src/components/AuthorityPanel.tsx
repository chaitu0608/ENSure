import { useQuery } from "@tanstack/react-query";
import { Check, CircleHelp, KeyRound, LoaderCircle, RefreshCw, ServerCog, TriangleAlert, Wallet2, X } from "lucide-react";
import { useAccount } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyValue } from "@/components/CopyValue";
import { NETWORK, NETWORK_NAME, deployment } from "@/lib/config";
import { api } from "@/lib/api";
import { readAuthority, readQuickNameAuthority, type Actor, type Authority, type PermissionRow, type Verdict } from "@/lib/authority";
import { explorerAddress, shortAddress } from "@/lib/utils";

const LOOK: Record<Verdict, { label: string; icon: typeof Check; className: string }> = {
  allowed: { label: "Allowed", icon: Check, className: "permission-allowed" },
  blocked: { label: "Reverts", icon: X, className: "permission-blocked" },
  unknown: { label: "Unknown", icon: CircleHelp, className: "permission-unknown" },
};

function Cell({ verdict }: { verdict: Verdict }) {
  const { label, icon: Icon, className } = LOOK[verdict];
  return <td data-verdict={verdict}><span className={`permission-cell ${className}`}><Icon aria-hidden="true" className="size-3.5" />{label}</span></td>;
}

function Boundary({ state }: { state: Authority["boundary"] }) {
  if (state === "holds") return <Badge variant="success"><Check aria-hidden="true" className="size-3.5" /> Publisher cannot touch production</Badge>;
  if (state === "broken") return <Badge variant="danger"><X aria-hidden="true" className="size-3.5" /> Publisher can write production</Badge>;
  return <Badge variant="warning"><CircleHelp aria-hidden="true" className="size-3.5" /> Could not complete the test</Badge>;
}

function Group({ title, rows, actors }: { title: string; rows: PermissionRow[]; actors: Actor[] }) {
  return <tbody>
    <tr className="permission-group"><th colSpan={actors.length + 1} scope="colgroup">{title}</th></tr>
    {rows.map((row) => <tr key={row.id} data-row={row.id}><th scope="row">{row.action}</th>{actors.map((actor) => <Cell key={actor.id} verdict={row.results[actor.id]} />)}</tr>)}
  </tbody>;
}

/** Plain-language summary, taken from the simulated calls above, never from the role names. */
function summary(actor: Actor, rows: PermissionRow[]) {
  const can = (ids: string[]) => {
    const verdicts = rows.filter((row) => ids.includes(row.id)).map((row) => row.results[actor.id]);
    return verdicts.includes("unknown") ? "unknown" : verdicts.some((v) => v === "allowed") ? "yes" : "no";
  };
  return { production: can(["prod-hash", "prod-approval", "prod-grant", "prod-repoint"]), preview: can(["preview-hash", "preview-build"]) };
}

function where(actor: Actor) {
  if (actor.roles.includes("publisher") && actor.roles.includes("owner")) return "One wallet holds both roles";
  if (actor.roles.includes("publisher")) return actor.isYou ? "The server's publishing key, imported into this wallet. On a real project it stays on the server" : "The server's publishing key (PUBLISHER_PRIVATE_KEY). Deploys sign with it";
  if (actor.roles.includes("owner")) return "The owner's own wallet, such as MetaMask";
  if (actor.roles.includes("controller")) return "Smart contract";
  if (actor.roles.includes("platform")) return `Owns ${deployment.platform?.name ?? "the quick-name parent"}, the parent of every quick name`;
  return "No role on this project";
}

function WalletCard({ actor, rows }: { actor: Actor; rows: PermissionRow[] }) {
  const s = summary(actor, rows);
  const Icon = actor.roles.includes("publisher") && !actor.roles.includes("owner") ? ServerCog : actor.roles.length ? KeyRound : Wallet2;
  const word = (v: string, yes: string, no: string) => (v === "yes" ? yes : v === "no" ? no : "Unknown");
  return <li className={`wallet-card ${actor.isYou ? "wallet-card-you" : ""}`} data-testid="wallet-card" data-roles={actor.roles.join(",") || "none"} data-you={actor.isYou}>
    <div className="wallet-card-top"><span className="wallet-card-icon"><Icon aria-hidden="true" className="size-4" /></span><div className="min-w-0"><p className="wallet-card-title">{actor.label}</p><p className="wallet-card-where">{where(actor)}</p></div>{actor.isYou && <Badge variant="neutral" className="ml-auto shrink-0">You</Badge>}</div>
    <CopyValue value={actor.address} className="mt-3 font-mono text-xs text-foreground"><a href={explorerAddress(actor.address)} target="_blank" rel="noreferrer" className="hover:underline">{actor.address}</a></CopyValue>
    <dl className="wallet-card-can">
      <div><dt>Production</dt><dd className={s.production === "yes" ? "permission-allowed" : s.production === "no" ? "permission-blocked" : "permission-unknown"}>{word(s.production, "Can change it", "Can't change it")}</dd></div>
      <div><dt>Preview</dt><dd className={s.preview === "yes" ? "permission-allowed" : s.preview === "no" ? "permission-blocked" : "permission-unknown"}>{word(s.preview, "Can publish", "Can't publish")}</dd></div>
    </dl>
  </li>;
}

export function QuickNameAuthorityPanel({ name }: { name: string }) {
  const { address } = useAccount();
  const quick = useQuery({ queryKey: ["quick-authority", name, address ?? "none"], queryFn: () => readQuickNameAuthority(name, address), staleTime: 15_000 });
  const data = quick.data;
  const differentOwner = Boolean(data && data.actors.find((a) => a.roles.includes("platform"))?.address.toLowerCase() !== data.projectOwner.toLowerCase());
  return <section className="authority-panel" aria-labelledby="quick-authority-title" data-testid="quick-authority-panel">
    <div className="authority-heading">
      <div><p className="eyebrow">Quick name / Live on {NETWORK_NAME}</p><h2 id="quick-authority-title">Who can change {name}.</h2><p>{name} is a quick name under {data?.parent ?? "the platform name"}. The server's publishing key writes it directly, with no owner approval, which is why Verify says UNPROTECTED. Each answer is a simulated call. Nothing is sent.</p></div>
    </div>
    {quick.error ? <p role="alert" className="authority-error"><Badge variant="warning">UNAVAILABLE</Badge> {quick.error instanceof Error ? quick.error.message : `${NETWORK_NAME} read failed`}</p> : !data ? <p className="authority-wait" role="status"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Reading {name}…</p> : <>
      {differentOwner && <p className="role-note" data-testid="quick-owner-note">{data.parent} is owned by a different wallet from {deployment.projectName}'s owner. The two names don't share any roles.</p>}
      <ul className="wallet-cards mt-4" aria-label="Wallets and their roles">{data.actors.map((actor) => <QuickCard key={actor.id} actor={actor} rows={data.rows} />)}</ul>
      <p className="role-note">Read at block {data.block.toString()}. For an owner-approved release with separate preview and production, deploy to {deployment.projectName}.</p>
    </>}
  </section>;
}

function QuickCard({ actor, rows }: { actor: Actor; rows: PermissionRow[] }) {
  const verdicts = rows.map((row) => row.results[actor.id]);
  const can = verdicts.includes("unknown") ? "unknown" : verdicts.some((v) => v === "allowed") ? "yes" : "no";
  return <li className={`wallet-card ${actor.isYou ? "wallet-card-you" : ""}`} data-testid="wallet-card" data-roles={actor.roles.join(",") || "none"} data-you={actor.isYou}>
    <div className="wallet-card-top"><span className="wallet-card-icon"><KeyRound aria-hidden="true" className="size-4" /></span><div className="min-w-0"><p className="wallet-card-title">{actor.label}</p><p className="wallet-card-where">{where(actor)}</p></div>{actor.isYou && <Badge variant="neutral" className="ml-auto shrink-0">You</Badge>}</div>
    <CopyValue value={actor.address} className="mt-3 font-mono text-xs text-foreground"><a href={explorerAddress(actor.address)} target="_blank" rel="noreferrer" className="hover:underline">{actor.address}</a></CopyValue>
    <dl className="wallet-card-can"><div><dt>This site</dt><dd className={can === "yes" ? "permission-allowed" : can === "no" ? "permission-blocked" : "permission-unknown"}>{can === "yes" ? "Can change it" : can === "no" ? "Can't change it" : "Unknown"}</dd></div></dl>
  </li>;
}

export function AuthorityPanel() {
  const { address } = useAccount();
  const authority = useQuery({ queryKey: ["authority", address ?? "none"], queryFn: () => readAuthority(address), staleTime: 15_000 });
  // Cross-checks the address in the deployment file against the key the server actually signs with.
  const server = useQuery({ queryKey: ["networks"], queryFn: api.networks, retry: false, staleTime: 60_000 });
  const data = authority.data;
  const publisher = data?.actors.find((actor) => actor.roles.includes("publisher"));
  const serverPublisher = server.data?.[NETWORK].publisher;
  const publisherMismatch = Boolean(publisher && serverPublisher && serverPublisher.toLowerCase() !== publisher.address.toLowerCase());
  return <section className="authority-panel" aria-labelledby="authority-title" data-testid="authority-panel">
    <div className="authority-heading">
      <div><p className="eyebrow">ENSv2 Enhanced Access Control / Live on {NETWORK_NAME}</p><h2 id="authority-title">Who can change {deployment.projectName}.</h2><p>Every wallet with a role on this project, plus the one you're connected with. Each answer below is a simulated call from that address against the live contracts, so a revert is the contract refusing. Nothing is sent.</p></div>
      <div className="authority-actions">{data && !authority.isFetching && <Boundary state={data.boundary} />}<Button variant="secondary" size="sm" disabled={authority.isFetching} onClick={() => void authority.refetch()}>{authority.isFetching ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />} Run again</Button></div>
    </div>
    {authority.error ? <p role="alert" className="authority-error"><Badge variant="warning">UNAVAILABLE</Badge> {authority.error instanceof Error ? authority.error.message : `${NETWORK_NAME} read failed`}</p> : !data ? <p className="authority-wait" role="status"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Simulating each write against {NETWORK_NAME}…</p> : <>
      {data.sharedOwnerPublisher && <p role="alert" className="setup-warning" data-testid="shared-wallet"><TriangleAlert aria-hidden="true" className="size-4 shrink-0" /><span>The owner and the publisher are the same wallet, so a leaked publisher key could change production. Give the publisher its own key.</span></p>}
      {publisherMismatch && <p role="alert" className="setup-warning" data-testid="publisher-mismatch"><TriangleAlert aria-hidden="true" className="size-4 shrink-0" /><span>The server publishes with {shortAddress(serverPublisher!)}, but this project's publisher is {shortAddress(publisher!.address)}. Server deploys to preview will fail until they match.</span></p>}
      <ul className="wallet-cards" aria-label="Wallets and their roles">{data.actors.map((actor) => <WalletCard key={actor.id} actor={actor} rows={data.rows} />)}</ul>
      {!address && <p className="role-note">Connect a wallet to see what it can do here.</p>}
      <div className="permission-scroll mt-8"><table className="permission-table">
        <thead><tr><th scope="col">Action</th>{data.actors.map((actor) => <th key={actor.id} scope="col" data-actor={actor.roles.join(",") || "none"}>{actor.label}{actor.isYou && <span className="you-tag">You</span>}<small title={actor.address}>{shortAddress(actor.address)}</small></th>)}</tr></thead>
        <Group title={`Production · ${data.tokens[0].name}`} rows={data.rows.filter((row) => row.environment === "Production")} actors={data.actors} />
        <Group title={`Preview · ${data.tokens[1].name}`} rows={data.rows.filter((row) => row.environment === "Preview")} actors={data.actors} />
      </table></div>
      <div className="authority-evidence">
        <div>
          <p className="eyebrow">Role bitmaps read from each resolver</p>
          <ul className="role-list">{data.roles.filter((entry) => entry.roles.length).map((entry) => <li key={`${entry.actor}-${entry.resolver}-${entry.scope}`}><span>{data.actors.find((actor) => actor.id === entry.actor)?.label} · {entry.resolver} · {entry.scope}</span><code>{entry.roles.join(", ")}</code></li>)}</ul>
          {publisher && !data.roles.some((entry) => entry.actor === publisher.id && entry.resolver === "Production" && entry.roles.length) && <p className="role-note">The publisher holds no roles on the production resolver.</p>}
        </div>
        <div>
          <p className="eyebrow">ERC-1155 name tokens</p>
          <ul className="role-list">{data.tokens.map((token) => <li key={token.name}><span>{token.name}</span><code title={token.tokenId.toString()}>Held by {data.actors.find((actor) => actor.address.toLowerCase() === token.owner.toLowerCase())?.label ?? shortAddress(token.owner)} · {shortAddress(token.owner)}</code></li>)}</ul>
          <p className="role-note">Read at block {data.block.toString()}.</p>
        </div>
      </div>
    </>}
  </section>;
}
