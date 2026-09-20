/**
 * scripts/setup-ocr-assets.ts
 *
 * Copies Tesseract.js runtime assets to public/ocr/ for same-origin serving.
 * Run once after `pnpm install`, or automatically as part of the build pipeline.
 *
 * Assets copied:
 *   - worker.min.js          — Tesseract.js Web Worker script
 *   - core/*.wasm.js         — tesseract.js-core WASM+JS bundles (LSTM-only variants)
 *   - lang/*.traineddata.gz  — Arabic + English language data
 *
 * Language data is downloaded from jsdelivr CDN at setup time (not at user runtime).
 * The student's image never leaves the browser.
 */

import { cpSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const publicOcr = resolve(projectRoot, "public", "ocr");

const require = createRequire(import.meta.url);

// ── Worker & Core Package Resolution ──────────────────────────────────
// Resolve tesseract.js-core relative to the installed tesseract.js package dependency graph
// to avoid relying on accidental pnpm hoisting or transitive package visibility.
const tesseractPkgPath = require.resolve("tesseract.js/package.json");
const tesseractDir = dirname(tesseractPkgPath);
const workerSrc = resolve(tesseractDir, "dist", "worker.min.js");

const tesseractRequire = createRequire(tesseractPkgPath);
const corePkgPath = tesseractRequire.resolve("tesseract.js-core/package.json");
const coreDir = dirname(corePkgPath);
const CORE_FILES = [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
] as const;

// ── Language data ──────────────────────────────────────────────────────
const LANG_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@tesseract.js-data";
const LANG_VERSION = "4.0.0_best_int";
const LANGUAGES = ["eng", "ara"] as const;

async function downloadLangData(
  lang: string,
  destDir: string
): Promise<void> {
  const destFile = resolve(destDir, `${lang}.traineddata.gz`);
  if (existsSync(destFile)) {
    console.log(`  ✓ ${lang}.traineddata.gz (cached)`);
    return;
  }

  const url = `${LANG_BASE_URL}/${lang}/${LANG_VERSION}/${lang}.traineddata.gz`;
  console.log(`  ↓ Downloading ${lang}.traineddata.gz ...`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destFile, buf);
  console.log(`  ✓ ${lang}.traineddata.gz (${(buf.length / 1024).toFixed(0)} KB)`);
}

async function main(): Promise<void> {
  console.log("Setting up OCR assets in public/ocr/ ...\n");

  // Create directories
  const coreDestDir = resolve(publicOcr, "core");
  const langDestDir = resolve(publicOcr, "lang");
  mkdirSync(coreDestDir, { recursive: true });
  mkdirSync(langDestDir, { recursive: true });

  // Copy worker
  cpSync(workerSrc, resolve(publicOcr, "worker.min.js"));
  console.log("✓ worker.min.js");

  // Copy core WASM files
  for (const file of CORE_FILES) {
    cpSync(resolve(coreDir, file), resolve(coreDestDir, file));
    console.log(`✓ core/${file}`);
  }

  // Download language data
  console.log("\nLanguage data:");
  for (const lang of LANGUAGES) {
    await downloadLangData(lang, langDestDir);
  }

  console.log("\n✅ OCR assets ready.");
}

main().catch((err) => {
  console.error("Failed to set up OCR assets:", err);
  process.exit(1);
});
