import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

/**
 * Peoplevate frontend Vite configuration.
 *
 * Optimisation decisions (see project docs for rationale):
 *  - Route-level code splitting is already done via React.lazy() in router.tsx.
 *    This config adds manual chunking so third-party vendors are cached
 *    independently and the shared entry chunk stays small.
 *  - Source maps are emitted only for production so crash reports map back to
 *    real source; they are stripped of sourcesContent to keep uploads lean.
 *  - Small SVGs are inlined as data URIs to avoid extra network round-trips.
 */

// Path alias shared by Vite, TypeScript (tsconfig) and Vitest.
const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

/**
 * Injects the app version from package.json into the page <title> so the
 * version shown in the browser tab always stays in sync with the published
 * package (e.g. "Peoplevate v0.1.0"). Applied at both build and dev time.
 */
function injectAppVersion(): Plugin {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
    version: string;
  };
  const title = `Peoplevate v${pkg.version}`;

  return {
    name: 'inject-app-version',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'title',
            children: title,
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    injectAppVersion(),
    // NOTE: For bundle-size analysis, optionally add rollup-plugin-visualizer
    // (devDependency) and uncomment below to emit ./dist/bundle-report.html:
    //
    //   import { visualizer } from 'rollup-plugin-visualizer';
    //   visualizer({ filename: './dist/bundle-report.html', gzipSize: true, open: false })
  ],

  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
    // Keep CSS minification on in production (default). Lightning CSS is not
    // used because Tailwind v4 already handles modern CSS output.
  },

  resolve: {
    alias,
  },

  build: {
    // Off by default for production: emitting .map files would expose the full
    // source of this private admin app to anyone who can reach the assets. Set
    // `VITE_SOURCEMAP=true` locally or in CI when you need maps for error
    // tracking (e.g. Sentry) — it then emits maps next to the bundles.
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
    // Bump the warning threshold so we get alerted for genuinely large chunks
    // rather than the default noise for the vendor chunk.
    chunkSizeWarningLimit: 800,
    // Aligned with the TypeScript compilerOptions.target/lib (ES2024) in
    // tsconfig.json — Vite should not down-level below the baseline TS assumes.
    target: 'es2024',
    cssCodeSplit: true,
    // Cache-friendly, content-hashed filenames with a stable directory layout.
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        // Function-form manualChunks groups third-party vendors into stable,
        // independently-cacheable chunks while leaving app code in its own
        // route-level chunks. Each group is emitted only if actually used.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // React runtime — always loaded, cached independently from app code.
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router/')
          ) {
            return 'react-vendor';
          }
          // Radix UI primitives share a runtime and change less often than app code.
          if (id.includes('/@radix-ui/')) {
            return 'radix-ui';
          }
          // Heavy animation library — isolated so page bundles don't block on it.
          if (id.includes('/framer-motion/')) {
            return 'animation';
          }
          // Form handling utilities shared across many pages.
          if (id.includes('/formik/')) {
            return 'forms';
          }
          // Classname + styling utilities.
          if (
            id.includes('/clsx/') ||
            id.includes('/class-variance-authority/') ||
            id.includes('/tailwind-merge/')
          ) {
            return 'utils';
          }
          // Icon set — extracted so tree-shaken icons live together.
          if (id.includes('/lucide-react/')) {
            return 'icons';
          }
          return undefined;
        },
      },
    },
  },

  server: {
    port: Number(process.env.VITE_DEV_PORT) || 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
        // No rewrite: the backend serves routes under the /api prefix, so the
        // incoming path is forwarded as-is.
      },
    },
  },

  preview: {
    port: 4173,
    strictPort: true,
  },

  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router'],
  },
});
