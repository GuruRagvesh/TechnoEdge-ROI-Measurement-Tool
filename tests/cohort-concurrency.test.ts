import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorage } from "../src/lib/storage";
import { runCohortProbe } from "../scripts/cohort-probe-lib";
it("persists 20 simultaneous participants through paired rounds, duplicate submissions, readback, grading and exports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "technoedge-cohort-"));
  try {
    const r = await runCohortProbe(() => new LocalStorage(dir), 20);
    expect(r).toMatchObject({
      participants: 20,
      submittedAttempts: 40,
      evidenceFiles: 120,
      eligiblePairs: 20,
      livePilot: false,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
