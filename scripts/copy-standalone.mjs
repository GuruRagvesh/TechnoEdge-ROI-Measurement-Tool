import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
const dist = process.env.NEXT_DIST_DIR || ".next-app";
const root = path.resolve(dist, "standalone");
await mkdir(path.join(root, dist), { recursive: true });
await cp(dist + "/static", path.join(root, dist + "/static"), {
  recursive: true,
});
await cp("public", path.join(root, "public"), { recursive: true });
