import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.resolve(__dirname, "../node_modules/@duckdb/duckdb-wasm/dist");
const destDir = path.resolve(__dirname, "../public/duckdb");

fs.mkdirSync(destDir, { recursive: true });

const filesToCopy = [
  "duckdb-mvp.wasm",
  "duckdb-eh.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-browser-eh.worker.js",
];

for (const file of filesToCopy) {
  const srcFile = path.join(srcDir, file);
  const destFile = path.join(destDir, file);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, destFile);
    const stats = fs.statSync(destFile);
    console.log(`Copied ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB) to public/duckdb/`);
  } else {
    console.warn(`Source file not found: ${srcFile}`);
  }
}
