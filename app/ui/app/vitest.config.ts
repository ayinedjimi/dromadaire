import { defineConfig, mergeConfig } from "vite";
import path from "path";
import baseConfig from "./vite.config";

export default defineConfig((configEnv) =>
  mergeConfig(
    baseConfig(configEnv),
    defineConfig({
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./src"),
          "@/gotypes": path.resolve(__dirname, "./codegen/gotypes.gen.ts"),
        },
      },
      test: {
        environment: "node",
        globals: true,
        exclude: [
          "**/node_modules/**",
          "**/_v4_frontend_backup/**",
          "**/src_backup_v4_merge/**",
          "**/e2e/**",
        ],
        coverage: {
          provider: "v8",
          reporter: ["text", "text-summary", "lcov"],
          reportsDirectory: "./coverage",
          include: ["src/**/*.{ts,tsx}"],
          exclude: [
            "src/**/*.test.{ts,tsx}",
            "src/**/*.spec.{ts,tsx}",
            "src/routeTree.gen.ts",
            "src/routes/**",
          ],
        },
      },
    }),
  ),
);
