import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };

/** The public domain KIPS is shared under. */
const CANONICAL_URL = "https://www.trykips.app";

/**
 * Link previews need an absolute image URL on a domain anyone can open, so it
 * is the public domain rather than a Vercel deployment URL (those can sit
 * behind Vercel's login). VITE_SITE_URL overrides it, e.g. for another domain.
 */
function siteUrl(): string {
  return (process.env.VITE_SITE_URL || CANONICAL_URL).replace(/\/$/, "");
}

const linkPreview = (): Plugin => ({
  name: "kips-link-preview",
  transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", siteUrl()),
});

export default defineConfig({
  plugins: [react(), linkPreview()],
  // "@/..." resolves to src/, the shadcn convention (e.g. @/components/ui/...).
  resolve: { alias: { "@": "/src" } },
  build: {
    rollupOptions: {
      output: {
        // Keep the large, rarely-changing libraries in their own cached files.
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (/node_modules[\\/](viem|ox|abitype|@noble|@scure)[\\/]/.test(id)) return "viem";
        },
      },
    },
  },
});
