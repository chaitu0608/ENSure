import { useQuery } from "@tanstack/react-query";
import { Check, CircleHelp, LoaderCircle, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readAuthority, type Authority, type PermissionRow, type Verdict } from "@/lib/authority";
import { shortAddress } from "@/lib/utils";

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
  if (state === "holds") return <Badge variant="success"><Check aria-hidden="true" className="size-3.5" /> CI cannot touch production</Badge>;
  if (state === "broken") return <Badge variant="danger"><X aria-hidden="true" className="size-3.5" /> CI can write production</Badge>;
  return <Badge variant="warning"><CircleHelp aria-hidden="true" className="size-3.5" /> Could not complete the test</Badge>;
}

function Group({ title, rows, actors }: { title: string; rows: PermissionRow[]; actors: Authority["actors"] }) {
  return <tbody>
    <tr className="permission-group"><th colSpan={actors.length + 1} scope="colgroup">{title}</th></tr>
    {rows.map((row) => <tr key={row.id} data-row={row.id}><th scope="row">{row.action}</th>{actors.map((actor) => <Cell key={actor.id} verdict={row.results[actor.id]} />)}</tr>)}
  </tbody>;
}

export function AuthorityPanel() {
  const authority = useQuery({ queryKey: ["authority"], queryFn: readAuthority, staleTime: 15_000 });
  const data = authority.data;
  return <section className="authority-panel" aria-labelledby="authority-title" data-testid="authority-panel">
    <div className="authority-heading">
      <div><p className="eyebrow">ENSv2 Enhanced Access Control / Live on Sepolia</p><h2 id="authority-title">Who can change what.</h2><p>Each cell is a simulated call from that address against the live contract, so a revert here is the contract refusing. No transaction is sent.</p></div>
      <div className="authority-actions">{data && !authority.isFetching && <Boundary state={data.boundary} />}<Button variant="secondary" size="sm" disabled={authority.isFetching} onClick={() => void authority.refetch()}>{authority.isFetching ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />} Run again</Button></div>
    </div>
    {authority.error ? <p role="alert" className="authority-error"><Badge variant="warning">UNAVAILABLE</Badge> {authority.error instanceof Error ? authority.error.message : "Sepolia read failed"}</p> : !data ? <p className="authority-wait" role="status"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Simulating each write against Sepolia…</p> : <>
      <div className="permission-scroll"><table className="permission-table">
        <thead><tr><th scope="col">Action</th>{data.actors.map((actor) => <th key={actor.id} scope="col">{actor.label}<small title={actor.address}>{shortAddress(actor.address)}</small></th>)}</tr></thead>
        <Group title={`Production · ${data.tokens[0].name}`} rows={data.rows.filter((row) => row.environment === "Production")} actors={data.actors} />
        <Group title={`Preview · ${data.tokens[1].name}`} rows={data.rows.filter((row) => row.environment === "Preview")} actors={data.actors} />
      </table></div>
      <div className="authority-evidence">
        <div>
          <p className="eyebrow">Role bitmaps read from each resolver</p>
          <ul className="role-list">{data.roles.filter((entry) => entry.roles.length).map((entry) => <li key={`${entry.actor}-${entry.resolver}-${entry.scope}`}><span>{data.actors.find((actor) => actor.id === entry.actor)?.label} · {entry.resolver} · {entry.scope}</span><code>{entry.roles.join(", ")}</code></li>)}</ul>
          {!data.roles.some((entry) => entry.actor === "ci" && entry.roles.length) && <p className="role-note">The CI publisher holds no roles on either resolver.</p>}
        </div>
        <div>
          <p className="eyebrow">ERC-1155 name tokens</p>
          <ul className="role-list">{data.tokens.map((token) => <li key={token.name}><span>{token.name}</span><code title={token.tokenId.toString()}>Held by {shortAddress(token.owner)}</code></li>)}</ul>
          <p className="role-note">Read at block {data.block.toString()}.</p>
        </div>
      </div>
    </>}
  </section>;
}
