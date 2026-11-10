import { NETWORK, type Network } from "./config";
// The ENSure API, for the deploy pages only. Verify never uses it: it reads the chain and gateways directly.
import type { Deploy, DeployStatus, Project, Receipt } from "@ensure/core/api";

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method,
    credentials: "include",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch(() => { throw new ApiError(`Can't reach the ENSure API at ${API_URL}. Start it with: corepack pnpm api`, 0); });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `Request failed: ${res.status}`, res.status);
  return json as T;
}

export type DeployRow = { id: string; commitSha: string | null; status: DeployStatus; error: string | null; receipt: Receipt | null; createdAt: string };
export type NewProject = { repoUrl: string; branch?: string; subfolder?: string; outputDir?: string; name?: string; network?: Network; deploy: boolean };

export const api = {
  me: () => call<{ user: { login: string; provider: string } }>("/auth/me").then((r) => r.user),
  networks: () => call<Record<Network, { ready: boolean; publisher: string | null; quickNames: boolean }> & { buildSandbox?: "docker" | "local" }>("/networks"),
  providers: () => call<{ github: boolean; google: boolean }>("/auth/providers"),
  logout: () => call("/auth/logout", { method: "POST" }),
  repos: () => call<{ repos: { id: string; fullName: string; private: boolean; defaultBranch: string }[] }>("/github/repos").then((r) => r.repos),
  branches: (fullName: string) => call<{ branches: string[] }>(`/github/repos/${fullName}/branches`).then((r) => r.branches),
  projects: () => call<{ projects: Project[] }>("/projects").then((r) => r.projects),
  project: (id: string) => call<{ project: Project }>(`/projects/${id}`).then((r) => r.project),
  createProject: (body: NewProject) => call<{ project: Project; deploy?: Deploy }>("/projects", { method: "POST", body }),
  deleteProject: (id: string) => call(`/projects/${id}`, { method: "DELETE" }),
  deploys: (projectId: string) => call<{ deploys: DeployRow[] }>(`/projects/${projectId}/deploys`).then((r) => r.deploys),
  deploy: (projectId: string) => call<{ deploy: Deploy }>("/deploys", { method: "POST", body: { projectId } }).then((r) => r.deploy),
  rollback: (projectId: string, deployId: string) => call<{ txHash: string }>(`/projects/${projectId}/rollback`, { method: "POST", body: { deployId } }),
  challenge: (name: string, wallet: string) => call<{ nonce: string; message: string }>("/names/custom/challenge", { method: "POST", body: { name, wallet, network: NETWORK } }),
  proveName: (nonce: string, signature: string) => call("/names/custom/verify", { method: "POST", body: { nonce, signature } }),
};

export const loginUrl = (provider: "github" | "google") => `${API_URL}/auth/${provider}`;
export const isFinished = (status: DeployStatus) => !["queued", "running"].includes(status);
export const eventsUrl = (deployId: string) => `${API_URL}/deploys/${deployId}/events`;
