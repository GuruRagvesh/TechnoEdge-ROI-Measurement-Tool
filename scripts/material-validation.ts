import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { answerKey } from "../src/lib/challenges";
import { materials } from "../src/lib/materials";
import { TASK_IDS, type Phase, type TaskId } from "../src/lib/types";
function csv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  assert(!quoted, "Unterminated source CSV field");
  const headers = rows.shift()!;
  return rows.map(
    (r) =>
      Object.fromEntries(headers.map((k, i) => [k, r[i]])) as Record<
        string,
        string
      >,
  );
}
export async function validateMaterials(phase: Phase) {
  const packs = Object.fromEntries(
    await Promise.all(
      TASK_IDS.map(async (t) => [
        t,
        await JSZip.loadAsync(await materials(t, phase)),
      ]),
    ),
  ) as Record<TaskId, JSZip>;
  const emails = csv(await packs.inbox.file("inbox.csv")!.async("string"));
  assert.equal(emails.length, 100);
  assert.equal(
    Object.keys(packs.inbox.files).filter((n) => n.endsWith(".eml")).length,
    100,
  );
  const tables = new ExcelJS.Workbook();
  await tables.xlsx.load(
    (await packs.tables
      .file("hundred-tables.xlsx")!
      .async("nodebuffer")) as never,
  );
  assert.equal(tables.worksheets.length, 100);
  let count = 0,
    revenue = 0,
    units = 0,
    north = 0;
  for (const sheet of tables.worksheets) {
    assert.equal(sheet.getTables().length, 1);
    sheet.eachRow((r, i) => {
      if (i > 1) {
        count++;
        revenue += Number(r.getCell(4).value);
        units += Number(r.getCell(3).value);
        if (r.getCell(2).value === "NORTH") north += Number(r.getCell(4).value);
      }
    });
  }
  assert.equal(count, 500);
  const dirty = csv(
    await packs.clean.file("customers-dirty.csv")!.async("string"),
  );
  assert.equal(dirty.length, 240);
  const seen = new Set<string>();
  const unique = dirty.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  const accepted = unique.filter(
    (r) =>
      r.name.trim() &&
      r.email.trim().includes("@") &&
      ["NORTH", "SOUTH", "EAST", "WEST"].includes(
        r.region.trim().toUpperCase(),
      ),
  );
  const sales = new ExcelJS.Workbook();
  await sales.xlsx.load(
    (await packs.dashboard
      .file("dashboard-source.xlsx")!
      .async("nodebuffer")) as never,
  );
  const sh = sales.worksheets[0];
  assert.equal(sh.rowCount - 1, 360);
  let salesRevenue = 0,
    salesCost = 0,
    salesNorth = 0,
    target = 0;
  sh.eachRow((r, i) => {
    if (i > 1) {
      salesRevenue += Number(r.getCell(6).value);
      salesCost += Number(r.getCell(7).value);
      target += Number(r.getCell(8).value);
      if (r.getCell(3).value === "NORTH")
        salesNorth += Number(r.getCell(6).value);
    }
  });
  const doc = await JSZip.loadAsync(
    await packs.mbr.file("monthly-business-review.docx")!.async("nodebuffer"),
  );
  const text = (await doc.file("word/document.xml")!.async("string")).replace(
    /<[^>]+>/g,
    " ",
  );
  const number = (pattern: RegExp) => {
    const m = text.match(pattern);
    assert(m, `Missing Word report field ${pattern}`);
    return Number(m[1]);
  };
  const mRevenue = number(/Revenue:\s*INR\s+(\d+)/),
    mTarget = number(/Target:\s*INR\s+(\d+)/),
    mCost = number(/Operating costs:\s*INR\s+(\d+)/),
    mCustomers = number(/New customers:\s*(\d+)/);
  const expected: Record<TaskId, number[]> = {
    inbox: [
      emails
        .filter((e) => e.recipient === "Guru")
        .reduce((n, e) => n + Number(e.value), 0),
      emails.filter((e) => e.replied === "No").length,
      emails.filter((e) => e.containsQuestion === "Yes").length,
      emails.filter(
        (e) => e.containsQuestion === "Yes" && e.topic === "Payment terms",
      ).length,
    ],
    tables: [count, revenue, units, north],
    clean: [
      dirty.length - unique.length,
      accepted.length,
      unique.length - accepted.length,
      accepted.reduce((n, r) => n + Number(r.value), 0),
    ],
    dashboard: [salesRevenue, salesRevenue - salesCost, salesNorth, target],
    mbr: [mRevenue, mRevenue - mTarget, mRevenue - mCost, mCustomers],
  };
  const keys = answerKey(phase);
  for (const t of TASK_IDS) {
    assert.equal(keys[t].length, 4);
    for (let i = 0; i < 4; i++) {
      const q = keys[t][i];
      assert.equal(new Set(q.options).size, 4);
      assert.equal(
        Number(q.options[q.correct]),
        expected[t][i],
        `${phase}/${t}/Q${i + 1} does not reconcile with the downloaded source`,
      );
    }
    assert(
      (await packs[t].file("READ_ME.txt")!.async("string")).includes(
        "completeness /3",
      ),
    );
  }
  return {
    phase,
    validatedKeys: 20,
    expected,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(expected))
      .digest("hex"),
  };
}
