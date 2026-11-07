export { GatewayContentMismatchError, GatewayUnavailableError } from "../../../tools/ensure-sepolia/scripts/build-check";

export function cidFromPointer(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const cid = trimmed.startsWith("ipfs://") ? trimmed.slice("ipfs://".length).split("/")[0] : trimmed;
  return cid || undefined;
}
