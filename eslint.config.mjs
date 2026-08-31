import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party asset (pdfjs-dist's own worker build, copied
    // verbatim to public/ so the browser can fetch it — see
    // components/chat/PdfPageViewer.tsx) — not code this project owns or
    // should ever hand-edit, minified and not meaningfully lintable.
    "public/pdf.worker.min.mjs",
  ]),
]);

export default eslintConfig;
