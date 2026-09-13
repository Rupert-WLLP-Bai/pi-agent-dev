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
      // Overridable so parallel acceptance runs can target a non-default API port.
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
});
