import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NETWORK, switchNetwork, type Network } from "@/lib/config";

export function NetworkSwitch() {
  return <Select value={NETWORK} onValueChange={(value) => switchNetwork(value as Network)}>
    <SelectTrigger aria-label="Network" data-testid="network-switch" className="network-switch h-9 w-[118px] rounded-md px-3 text-xs">
      <span className={`mr-2 inline-block size-1.5 rounded-full ${NETWORK === "mainnet" ? "bg-amber-300" : "bg-foreground"}`} aria-hidden="true" />
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="min-w-[150px]">
      <SelectItem value="sepolia" className="text-xs">Sepolia</SelectItem>
      <SelectItem value="mainnet" className="text-xs">Mainnet</SelectItem>
    </SelectContent>
  </Select>;
}
