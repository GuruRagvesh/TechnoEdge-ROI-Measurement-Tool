import { storage } from "../src/lib/storage";
import { testGeneration } from "../src/lib/local-test-storage";
import { ensureTestData } from "../src/lib/local-test-data";
if (!process.env.NODE_ENV)
  Object.assign(process.env, { NODE_ENV: "development" });
const base = storage();
await ensureTestData(base, await testGeneration(base));
console.log(
  "Local account fixtures ensured. Existing assessment records were preserved.",
);
