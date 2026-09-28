import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    base: process.env.VITE_BASE_PATH || "/",
    server: {
      port: 5173,
      proxy: env.VITE_API_PROXY_TARGET
        ? {
            "/api": {
              target: env.VITE_API_PROXY_TARGET,
              changeOrigin: true,
              secure: false,
            },
            "/ws": {
              target: env.VITE_API_PROXY_TARGET,
              changeOrigin: true,
              secure: false,
              ws: true,
            },
          }
        : undefined,
    },
  };
});
