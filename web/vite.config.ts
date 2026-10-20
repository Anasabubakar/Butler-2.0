import { defineConfig } from "vite";

// In development, send API and file requests to a Butler server running locally.
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/files": "http://localhost:8080",
    },
  },
});
