import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };

/**
 * Link previews need an absolute image URL. On Vercel the build knows its own
 * address: the production domain, else the stable branch URL, else this
 * deployment's URL. VITE_SITE_URL overrides all of them.
 */
function siteUrl(): string {
  const e = process.env;
  if (e.VITE_SITE_URL) return e.VITE_SITE_URL.replace(/\/$/, "");
  const host =
    e.VERCEL_ENV === "production"
      ? e.VERCEL_PROJECT_PRODUCTION_URL
      : (e.VERCEL_BRANCH_URL ?? e.VERCEL_URL);
  return host ? `https://${host}` : "";
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
