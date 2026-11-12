import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
