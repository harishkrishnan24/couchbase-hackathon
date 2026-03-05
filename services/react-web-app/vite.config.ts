import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

const API_TARGET =
  process.env.VITE_PYTHON_FAST_API_CLIENT_URL || "http://python-fast-api:3030";

export default defineConfig({
  clearScreen: false,
  server: {
    allowedHosts: true,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    // Explicit aliases for reliable module resolution in both dev and SSR
    // While tsconfigPaths plugin reads from tsconfig.json, explicit aliases
    // ensure consistent resolution timing, especially for @ (root) imports
    alias: {
      '@': path.resolve(__dirname, '.'),
      '~': path.resolve(__dirname, './app'),
      '@clients': path.resolve(__dirname, './clients'),
    },
  },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
});
