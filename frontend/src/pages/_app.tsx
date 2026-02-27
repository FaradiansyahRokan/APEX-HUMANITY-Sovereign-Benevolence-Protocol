import type { AppProps } from "next/app";
import { defineChain } from "viem";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@rainbow-me/rainbowkit/styles.css";
import "../styles/globals.css";

const apexNetwork = defineChain({
  id: 6969,
  name: "APEXNETWORK",
  nativeCurrency: {
    decimals: 18,
    name:     "APEX Token",
    symbol:   "APEX",
  },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_RPC_URL ||
        "http://127.0.0.1:9654/ext/bc/iPWmyj3eTRsSFUmivVcqc7y4xeeeWvLdw78YNLLGv1JGxUPYG/rpc",
      ],
    },
  },
  testnet: true,
});

const wagmiConfig = getDefaultConfig({
  appName:   "APEX HUMANITY",
  appUrl:    "http://localhost:3000",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "apex-humanity-local",
  chains:    [apexNetwork],
  ssr:       true,
});

const queryClient = new QueryClient();

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <Component {...pageProps} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}