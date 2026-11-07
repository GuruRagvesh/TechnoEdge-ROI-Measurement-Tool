import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { largeOfficeFiles } from "./large-office-fixtures";
import { AssessmentService, metrics } from "../src/lib/assessment";
import { LocalStorage } from "../src/lib/storage";
import { excelReport, evidenceZip } from "../src/lib/reports";
import { attendee, host } from "./helpers";
it("persists large actual Excel and image-bearing PowerPoint packages and includes them in verified Excel/ZIP exports", async () => {
  const { xlsx, pptx } = await largeOfficeFiles();
  for (const data of [xlsx, pptx]) {
    expect(data.length).toBeGreaterThan(10 * 1024 * 1024);
    expect(data.length).toBeLessThanOrEqual(25 * 1024 * 1024);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as never);
  expect(wb.worksheets[0].rowCount).toBe(13001);
  const slides = await JSZip.loadAsync(pptx, { checkCRC32: true });
  expect(await slides.file("ppt/slides/slide1.xml")!.async("string")).toContain(
    'r:embed="rId2"',
  );
  expect(
    (
      await slides.file("ppt/media/dashboard.png")!.async("nodebuffer")
    ).subarray(0, 8),
  ).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const root = await mkdtemp(join(tmpdir(), "technoedge-large-office-"));
  try {
    const store = new LocalStorage(root),
      s = new AssessmentService(store);
    await s.defaultRoom();
    await s.join("ai-productivity-pre", attendee);
    await s.start("ai-productivity-pre", attendee.id, [
      "inbox",
      "dashboard",
      "mbr",
    ]);
    await s.upload(
      "ai-productivity-pre",
      attendee.id,
      "dashboard",
      "corporate-dashboard.xlsx",
      xlsx,
    );
    let p = await s.upload(
      "ai-productivity-pre",
      attendee.id,
      "mbr",
      "boardroom-review.pptx",
      pptx,
    );
    p = (await new AssessmentService(new LocalStorage(root)).participant(
      "ai-productivity-pre",
      attendee.id,
    ))!;
    expect(p.evidence).toHaveLength(2);
    expect((await store.read(p.evidence[1].path))!.data.equals(pptx)).toBe(
      true,
    );
    const report = await excelReport(
      s,
      await s.room("ai-productivity-pre"),
      host,
    );
    const exported = new ExcelJS.Workbook();
    await exported.xlsx.load(report as never);
    expect(exported.getWorksheet("Evidence")!.rowCount).toBe(3);
    const archive = await JSZip.loadAsync(
      await evidenceZip(s, await s.room("ai-productivity-pre"), host),
      { checkCRC32: true },
    );
    const manifest = JSON.parse(
      await archive.file("manifest.json")!.async("string"),
    );
    expect(manifest.files).toHaveLength(2);
    for (const e of manifest.files) {
      const key = Object.keys(archive.files).find((k) => k.endsWith(e.name))!;
      expect(
        (await archive.file(key)!.async("nodebuffer")).equals(
          e.task === "mbr" ? pptx : xlsx,
        ),
      ).toBe(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
