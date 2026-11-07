import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
const zip = new JSZip(),
  root = path.resolve(".");
const excluded = new Set([
  "node_modules",
  ".next",
  ".next-e2e",
  ".test-work",
  ".data",
  "test-results",
  "playwright-report",
  ".git",
]);
async function collect(dir = "") {
  for (const entry of await readdir(path.join(root, dir), {
    withFileTypes: true,
  })) {
    if (
      excluded.has(entry.name) ||
      entry.name.startsWith(".next") ||
      (entry.name.startsWith(".env") &&
        ![".env.example", ".env.staging.example"].includes(entry.name)) ||
      entry.name.endsWith(".tsbuildinfo")
    )
      continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(relative);
    else
      zip.file(
        "technoedge/" + relative.replaceAll("\\", "/"),
        await readFile(path.join(root, relative)),
      );
  }
}
await collect();
const output = path.resolve("../TechnoEdge-Assessment-ROI.zip");
await writeFile(
  output,
  await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
);
console.log("Source archive created: " + output);
