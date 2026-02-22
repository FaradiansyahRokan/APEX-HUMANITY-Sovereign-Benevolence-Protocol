"use client";

import "@rainbow-me/rainbowkit/styles.css";
import type { AppProps } from "next/app";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { polygon, polygonMumbai, hardhat } from "wagmi/chains";
import "../styles/globals.css";

// ── Wagmi + RainbowKit config ─────────────────────────────────────────────────
const config = getDefaultConfig({
  appName: "APEX HUMANITY — Sovereign Benevolence Protocol",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "apex-humanity-dev",
  chains: [
    hardhat,          // Local development
    polygonMumbai,    // Testnet
    polygon,          // Mainnet
  ],
  ssr: false,         // Disable SSR untuk Pages Router
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60, refetchOnWindowFocus: false },
  },
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor:          "#6366f1",   // Indigo
            accentColorForeground: "white",
            borderRadius:          "large",
            fontStack:             "system",
          })}
          locale="en-US"
        >
          <Component {...pageProps} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}