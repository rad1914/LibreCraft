'use client'

import dynamic from "next/dynamic";

// Three.js touches `window`/`document` at construction, so render the
// game client-only to avoid SSR hydration mismatches.
const MinecraftGame = dynamic(() => import("@/components/minecraft/MinecraftGame"), {
  ssr: false,
  loading: () => (
    <div className="w-screen h-screen flex items-center justify-center bg-[#9ad0ff] text-white">
      Loading world...
    </div>
  ),
});

export default function Home() {
  return <MinecraftGame />;
}
