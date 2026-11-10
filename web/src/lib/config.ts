/// <reference types="vite/client" />
import { fallback, http, createPublicClient, type Address } from "viem";
import { mainnet, sepolia } from "viem/chains";
import sepoliaFile from "../../../deployments/sepolia.json";
import mainnetFile from "../../../deployments/mainnet.json";

export type Network = "sepolia" | "mainnet";
export type Deployment = Omit<typeof sepoliaFile, "releaseController" | "protocol" | "legacyBuildManifests" | "platform"> & {
  protocol: {
    rootRegistry: Address;
    ethRegistry: Address;
    universalResolver: Address;
    universalHelper: Address;
    verifiableFactory: Address;
    registryImplementation: Address;
    resolverImplementation: Address;
  };
  releaseController: Address | null;
  /** Build manifests CI published for legacy releases whose prod ensure.build was never written. Keyed by site CID. */
  legacyBuildManifests: Record<string, string>;
  /** Quick names. Sepolia only. */
  platform: { name: string; registry: string; resolver: string } | null;
};

const NETWORK_KEY = "ensure.network";
function readNetwork(): Network {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("network");
    if (fromUrl === "mainnet" || fromUrl === "sepolia") {
      window.localStorage.setItem(NETWORK_KEY, fromUrl);
      return fromUrl;
    }
    return window.localStorage.getItem(NETWORK_KEY) === "mainnet" ? "mainnet" : "sepolia";
  } catch {
    return "sepolia";
  }
}

export const NETWORK: Network = readNetwork();
export const isMainnet = NETWORK === "mainnet";
export const NETWORK_NAME = isMainnet ? "Mainnet" : "Sepolia";
export const activeChain = isMainnet ? mainnet : sepolia;

/** Every client and address below is chosen once at load, so switching reloads the page. */
export function switchNetwork(network: Network) {
  try { window.localStorage.setItem(NETWORK_KEY, network); } catch { /* The URL below still carries the choice. */ }
  const url = new URL(window.location.href);
  url.searchParams.set("network", network);
  window.location.assign(url.toString());
}

export const deployment = (isMainnet ? mainnetFile : sepoliaFile) as unknown as Deployment;
/** False until this network has a project, which the Setup page creates. */
export const projectReady = Boolean(deployment.projectName);

export const GATEWAYS = [
  import.meta.env.VITE_PINATA_GATEWAY,
  deployment.pinataGateway,
  ...(import.meta.env.VITE_IPFS_GATEWAYS ?? "").split(","),
  "https://ipfs.filebase.io",
  "https://ipfs.io",
  "https://dweb.link",
].filter((value): value is string => Boolean(value)).map((value) => value.replace(/\/$/, ""));

const configuredRpc = (isMainnet ? import.meta.env.VITE_MAINNET_RPC_URL : import.meta.env.VITE_SEPOLIA_RPC_URL)?.trim();
const publicRpcs = isMainnet
  ? ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"]
  : ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org"];
export const rpcTransport = fallback([
  ...(configuredRpc ? [http(configuredRpc, { timeout: 10_000, retryCount: 1 })] : []),
  ...publicRpcs.map((url) => http(url, { timeout: 10_000, retryCount: 1 })),
], { retryCount: 0 });

export const publicClient = createPublicClient({ chain: activeChain, transport: rpcTransport });

export function resolverForName(name: string): Address | undefined {
  if (name.toLowerCase() === deployment.prodName.toLowerCase()) return deployment.prodResolver as Address;
  if (name.toLowerCase() === deployment.previewName.toLowerCase()) return deployment.previewResolver as Address;
  return undefined;
}

export function environmentLabel(name: string): "Production" | "Preview" | "Unknown" {
  if (name.toLowerCase() === deployment.prodName.toLowerCase()) return "Production";
  if (name.toLowerCase() === deployment.previewName.toLowerCase()) return "Preview";
  return "Unknown";
}
