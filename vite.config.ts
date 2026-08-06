import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Deployed to GitHub Pages as a project site at
// https://mjmorrison10.github.io/Creators-Stack/ — every asset URL must be
// built against this base. Use import.meta.env.BASE_URL for runtime fetches
// (e.g. arena-ranking.json) rather than absolute "/" paths.
export default defineConfig({
  base: "/Creators-Stack/",
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});
