import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Deployed to GitHub Pages as a project site at
// https://mjmorrison10.github.io/Creators-Stack/ — every asset URL must be
// built against this base. Use import.meta.env.BASE_URL for runtime fetches
// (e.g. arena-ranking.json) rather than absolute "/" paths.
export default defineConfig({
  base: "/Creators-Stack/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // The four legacy apps each shipped their own manifest; this replaces
      // all of them with one installable app at one scope.
      manifest: {
        name: "THE STACK",
        short_name: "THE STACK",
        description:
          "Clip memory, hook underwriting, posting command center and performance tracking in one app.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0E1116",
        theme_color: "#0E1116",
        categories: ["productivity", "utilities"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // public/vendor is ~31MB of ffmpeg wasm. Precaching it would make
        // every install download the crop engine whether or not the creator
        // ever crops anything — on a phone, on cellular. CropPanel's whole
        // design is to fetch that core only when the panel is opened, and an
        // e2e spec asserts no vendor/ request happens on load; precaching
        // would defeat both.
        globIgnores: ["**/vendor/**"],
        // The hashed JS bundle is over the 2MB default.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
        // Hash routing means every section is the same document, but the
        // ffmpeg core must never be answered from the app shell.
        navigateFallbackDenylist: [/^\/Creators-Stack\/vendor\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});
