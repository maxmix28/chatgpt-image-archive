import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const required = [
  "index.html",
  "src/app.js",
  "src/styles.css",
  "public/manifest.webmanifest",
  "service-worker.js",
  "README.md",
  "docs/chatgpt_image_archive_requirements.md",
  "docs/chatgpt_image_archive_codex_instructions.md"
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Missing required files:\n${missing.join("\n")}`);
  process.exit(1);
}

new Function(fs.readFileSync(path.join(root, "src/app.js"), "utf8"));
JSON.parse(fs.readFileSync(path.join(root, "public/manifest.webmanifest"), "utf8"));
console.log("Static app check passed.");
