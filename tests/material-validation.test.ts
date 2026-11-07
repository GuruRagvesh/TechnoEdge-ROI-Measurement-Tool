import { describe, expect, it } from "vitest";
import { validateMaterials } from "../scripts/material-validation";
describe("independent source-file answer-key reconciliation", () => {
  it("recomputes all 40 keys from the ten delivered CSV, Excel and Word packs and checks variant differences", async () => {
    const pre = await validateMaterials("pre"),
      post = await validateMaterials("post");
    expect(pre.validatedKeys + post.validatedKeys).toBe(40);
    expect(pre.fingerprint).not.toBe(post.fingerprint);
    for (const t of ["inbox", "tables", "clean", "dashboard", "mbr"] as const)
      expect(pre.expected[t]).not.toEqual(post.expected[t]);
  });
});
