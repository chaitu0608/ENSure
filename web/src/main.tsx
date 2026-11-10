import "./styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { NETWORK_NAME, activeChain, deployment, projectReady, rpcTransport } from "@/lib/config";
import { AppShell } from "@/components/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { DeployPage } from "@/pages/DeployPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { OpenPage } from "@/pages/OpenPage";
import { SetupPage } from "@/pages/SetupPage";
import { VerifyPage } from "@/pages/VerifyPage";
import { PromotePage } from "@/pages/PromotePage";
import { ReleasesPage } from "@/pages/ReleasesPage";

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: { [activeChain.id]: rpcTransport } as never,
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

/** These pages read a configured project, so a network without one goes to Setup. */
const NeedsProject = ({ children }: { children: React.ReactElement }) => (projectReady ? children : <Navigate to="/setup" replace />);

function App() {
  return <WagmiProvider config={wagmiConfig}><QueryClientProvider client={queryClient}><BrowserRouter>
    <Routes><Route element={<AppShell />}>
      <Route index element={<DashboardPage />} />
      <Route path="deploy" element={<DeployPage />} />
      <Route path="deploy/:id" element={<ProjectPage />} />
      <Route path="open" element={<OpenPage />} />
      <Route path="open/:name" element={<OpenPage />} />
      <Route path="setup" element={<SetupPage />} />
      <Route path="verify" element={<NeedsProject><VerifyPage /></NeedsProject>} />
      <Route path="promote" element={<NeedsProject><PromotePage /></NeedsProject>} />
      <Route path="releases" element={<NeedsProject><ReleasesPage /></NeedsProject>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route></Routes>
  </BrowserRouter></QueryClientProvider></WagmiProvider>;
}

document.title = `ENSure · ${deployment.projectName || NETWORK_NAME}`;
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
