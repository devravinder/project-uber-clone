import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// /api/<service>/... goes to that service, e.g. /api/driver/health -> driver-service /health.
const SERVICES = {
  rider: "RIDER_API",
  driver: "DRIVER_API",
  matching: "MATCHING_API",
  "matching-2": "MATCHING_2_API",
  trip: "TRIP_API",
  pricing: "PRICING_API",
  gateway: "GATEWAY_API",
  "gateway-2": "GATEWAY_2_API",
};

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy = Object.fromEntries(
    Object.entries(SERVICES).map(([service, variable]) => {
      const target = env[variable];
      if (command === "serve" && !target) {
        throw new Error(`Missing ${variable}. Set it in apps/web/.env.development`);
      }
      return [
        // The trailing slash keeps /api/matching from also matching /api/matching-2.
        `/api/${service}/`,
        {
          target,
          changeOrigin: true,
          rewrite: (path: string) => path.slice(`/api/${service}`.length),
        },
      ];
    }),
  );

  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5320, strictPort: true, proxy },
  };
});
