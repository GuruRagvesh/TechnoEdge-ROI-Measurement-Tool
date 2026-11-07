import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { AssessmentService } from "../src/lib/assessment";
import { evidenceZip, excelReport } from "../src/lib/reports";
import { answerKey, dataset } from "../src/lib/challenges";
import { materials } from "../src/lib/materials";
import { MemoryStorage, attendee, host } from "./helpers";
describe("real Office materials and exports", () => {
  it.each(["pre", "post"] as const)(
    "generates all five valid %s material packages and data-derived keys",
    async (phase) => {
      const inbox = await JSZip.loadAsync(await materials("inbox", phase));
      expect(
        Object.keys(inbox.files).filter((x) => x.endsWith(".eml")),
      ).toHaveLength(100);
      const tables = await JSZip.loadAsync(await materials("tables", phase));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(
        (await tables
          .file("hundred-tables.xlsx")!
          .async("nodebuffer")) as unknown as Parameters<
          typeof wb.xlsx.load
        >[0],
      );
      expect(wb.worksheets).toHaveLength(100);
      expect(wb.worksheets.reduce((n, s) => n + s.rowCount - 1, 0)).toBe(500);
      const data = dataset(phase);
      const actual = wb.worksheets.reduce((n, s) => {
          s.eachRow((r, i) => {
            if (i > 1) n += Number(r.getCell(4).value);
          });
          return n;
        }, 0),
        q = answerKey(phase).tables[1];
      expect(Number(q.options[q.correct])).toBe(actual);
      const clean = await JSZip.loadAsync(await materials("clean", phase));
      expect(
        (await clean.file("customers-dirty.csv")!.async("string")).split(
          "\r\n",
        ),
      ).toHaveLength(241);
      expect(data.clean.length).toBeLessThan(220);
      const dash = await JSZip.loadAsync(await materials("dashboard", phase));
      await wb.xlsx.load(
        (await dash
          .file("dashboard-source.xlsx")!
          .async("nodebuffer")) as unknown as Parameters<
          typeof wb.xlsx.load
        >[0],
      );
      expect(wb.worksheets[0].rowCount).toBe(361);
      const mbr = await JSZip.loadAsync(await materials("mbr", phase));
      const doc = await JSZip.loadAsync(
        await mbr.file("monthly-business-review.docx")!.async("nodebuffer"),
      );
      expect(await doc.file("word/document.xml")!.async("string")).toContain(
        String(data.mbr.revenue),
      );
    },
  );
  it("exports actual rows, timestamps, formulas as literal text, durable report and evidence checksum manifest", async () => {
    const store = new MemoryStorage(),
      s = new AssessmentService(store);
    const room = await s.defaultRoom();
    await s.join(room.id, { ...attendee, name: '=HYPERLINK("bad")' });
    await s.start(room.id, attendee.id, ["inbox", "tables", "clean"]);
    let p = await s.upload(
      room.id,
      attendee.id,
      "inbox",
      "result.csv",
      Buffer.from("A,B\r\n1,2"),
    );
    p = await s.save(room.id, attendee.id, {
      revision: p.revision,
      answers: { inbox: [0, 1, 2, 3] },
      notes: { inbox: "=SUM(1+1)" },
      completed: [],
    });
    const data = await excelReport(s, room, host),
      wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      "Read me",
      "Participants",
      "Task answers",
      "Practical evaluations",
      "Evidence",
      "Pre Post comparisons",
      "Modeled ROI",
    ]);
    expect(wb.getWorksheet("Participants")!.getCell("B2").value).toBe(
      '=HYPERLINK("bad")',
    );
    expect(wb.getWorksheet("Participants")!.getCell("B2").type).toBe(
      ExcelJS.ValueType.String,
    );
    expect(wb.getWorksheet("Practical evaluations")!.getCell("K2").value).toBe(
      "=SUM(1+1)",
    );
    expect(await store.list(`rooms/${room.id}/reports`)).toHaveLength(1);
    const zip = await JSZip.loadAsync(await evidenceZip(s, room, host));
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].sha256).toHaveLength(64);
    store.files.delete(p.evidence[0].path);
    await expect(evidenceZip(s, room, host)).rejects.toThrow("missing");
  });
});
