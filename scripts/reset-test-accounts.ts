import { storage } from "../src/lib/storage";
import { resetTestGeneration } from "../src/lib/local-test-storage";
import { ensureTestData } from "../src/lib/local-test-data";
if (!process.env.NODE_ENV)
  Object.assign(process.env, { NODE_ENV: "development" });
const base = storage();
const generation = await resetTestGeneration(base);
await ensureTestData(base, generation);
console.log(
  "Local test records restored. Existing test sessions must sign in again. Real assessment data was not changed.",
);
