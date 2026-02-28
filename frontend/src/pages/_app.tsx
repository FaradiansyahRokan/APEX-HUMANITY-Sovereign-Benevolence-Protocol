import type { AppProps } from "next/app";
import Head from "next/head";
import { defineChain } from "viem";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@rainbow-me/rainbowkit/styles.css";
import "../styles/globals.css";

// Dynamic RPC/AppUrl detection for Mobile support
const getDynamicConfig = () => {
  if (typeof window === "undefined") return { rpc: "http://127.0.0.1:9650", url: "http://localhost:3000" };
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const protocol = window.location.protocol;
  const port = window.location.port ? `:${window.location.port}` : "";

  // Use port 9655 for mobile proxy if not local, else 9654
  const rpcPort = isLocal ? "9650" : "9655";
  const rpcHost = isLocal ? "127.0.0.1" : host;
  const rpcUrl = `https://large-protocols-kick-nursing.trycloudflare.com/ext/bc/2J8FS94wi2HBQAiqcvVkJUeodDCHL3cRTPgcfgoFso5h8NSvaE/rpc`;
  const appUrl = `${protocol}//${host}${port}`;

  return { rpc: rpcUrl, url: appUrl };
};

const dynamicCfg = getDynamicConfig();

const apexNetwork = defineChain({
  id: 6969,
  name: "APEXNETWORK",
  nativeCurrency: {
    decimals: 18,
    name: "APEX Token",
    symbol: "APEX",
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RPC_URL || dynamicCfg.rpc],
    },
  },
  testnet: true,
});

const wagmiConfig = getDefaultConfig({
  appName: "APEX HUMANITY",
  appUrl: dynamicCfg.url,
  // Use the verified project ID from your .env.local
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "07c91816e8fa370601f5530ffae69547",
  chains: [apexNetwork],
  ssr: true,
  transports: {
    [apexNetwork.id]: http(),
  },
});

const queryClient = new QueryClient();

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <Head>
        <title>APEX Humanity</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#000000" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </Head>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <Component {...pageProps} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}