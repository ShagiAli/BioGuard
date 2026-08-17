import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxying keeps the browser on one origin, so the session cookie is
    // first-party and CORS never enters the picture during development.
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
