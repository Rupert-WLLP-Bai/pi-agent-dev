import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind all interfaces so the dev server is reachable from the Windows host
    // (WSL2 forwards IPv4 loopback only; an IPv6-only [::1] listener is unreachable).
    host: true,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
