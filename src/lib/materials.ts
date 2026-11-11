import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import { answerKey, catalogue, dataset, regions } from "./challenges";
import type { Phase, TaskId, ScoringVersion } from "./types";
const csv = (rows: Record<string, unknown>[]) =>
  [
    Object.keys(rows[0]).join(","),
    ...rows.map((x) =>
      Object.values(x)
        .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
        .join(","),
    ),
  ].join("\r\n");
export async function materials(
  task: TaskId,
  phase: Phase,
  version: ScoringVersion = "corporate-60-v1",
  single = false,
) {
  const d = dataset(phase),
    zip = new JSZip(),
    meta = catalogue[task];
  zip.file(
    "READ_ME.txt",
    `${meta.title}${single ? "" : " | " + phase.toUpperCase()}\n\n${meta.brief}\n\nDeliverables\n${meta.deliverables.join("\n")}\n\nScoring version: ${version}\n${version === "corporate-60-v1" ? "20 marks per task: 4 MCQs x 3 = 12; practical completeness /3, accuracy /3, presentation /2 = 8." : "Historical model: practical accuracy, quality and completeness each /5; final score 40% MCQ and 60% practical."}\n${meta.rubric.join("\n")}\n\nTime budget: shared server timer from confirmed room join, including task selection. Complete three tasks. ${single ? "One attempt per participant." : "Summit inherits your Base Camp categories. Pre-AI: work without generative AI. Post-AI: AI tools permitted; document your method."} All values are synthetic.\n`,
  );
  if (task === "inbox") {
    zip.file("inbox.csv", csv(d.emails));
    for (const e of d.emails)
      zip.file(
        `emails/${e.id}.eml`,
        `From: ${e.customer.replaceAll(" ", "").toLowerCase()}@example.com\r\nTo: ${e.recipient.toLowerCase()}@example.com\r\nSubject: ${e.subject} [${e.id}]\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCustomer: ${e.customer}\r\nOwner: ${e.owner}\r\nRecipient: ${e.recipient}\r\nPriority: ${e.priority}\r\nOverdue: ${e.overdue}\r\nValue: ${e.value}\r\nDue: ${e.due}\r\nContainsQuestion: ${e.containsQuestion}\r\nReplied: ${e.replied}\r\nTopic: ${e.topic}\r\n\r\nHello ${e.recipient},\r\n\r\nWe are coordinating the next learning programme for ${e.customer}. This message is the authoritative record for transaction ${e.id}. The amount receivable for this independent transaction is INR ${e.value}; it must not be added again if mentioned in a follow-up note. Our internal approval is due on ${e.due}. Please use that reference in the consolidated register so our accounts team can reconcile the request.\r\n\r\n${e.containsQuestion === "Yes" ? `Our question concerns ${e.topic}. Could you confirm the current arrangements and the next action our team should take? Several colleagues are coordinating attendance and need a single, consistent answer. Please include any conditions or prerequisites so that we can brief them accurately.` : "This is a status notification for your records. No question is included in this message. The attached transaction metadata remains the source of truth for the receivable."}\r\n\r\nCurrent response status: ${e.replied === "Yes" ? "A reply has been recorded by the service team. No unanswered-message escalation is required." : "No reply has been recorded. Please assign a follow-up owner and an appropriate next action."} The request has been classified ${e.priority.toLowerCase()} priority. Treat any proposed FAQ response as a draft for review; do not invent a policy that the source records do not establish.\r\n\r\nRegards,\r\nProgramme coordinator, ${e.customer}`,
      );
  }
  if (task === "tables") {
    const wb = new ExcelJS.Workbook();
    for (let n = 1; n <= 100; n++) {
      const sheet = wb.addWorksheet(`Table_${String(n).padStart(3, "0")}`);
      sheet.addTable({
        name: `Source_${n}`,
        ref: "A1",
        headerRow: true,
        columns: ["ID", "Region", "Units", "Revenue"].map((name) => ({ name })),
        rows: d.tables
          .filter((x) => x.table === n)
          .map((x) => [x.id, x.region, x.units, x.revenue]),
      });
    }
    zip.file("hundred-tables.xlsx", await wb.xlsx.writeBuffer());
  }
  if (task === "clean") zip.file("customers-dirty.csv", csv(d.dirty));
  if (task === "dashboard") {
    const wb = new ExcelJS.Workbook();
    const sh = wb.addWorksheet("Sales");
    sh.addTable({
      name: "SalesFact",
      ref: "A1",
      columns: Object.keys(d.sales[0]).map((name) => ({ name })),
      rows: d.sales.map(Object.values),
    });
    zip.file("dashboard-source.xlsx", await wb.xlsx.writeBuffer());
    zip.file(
      "visual-brief.txt",
      "Include at least 10 visuals: monthly revenue, monthly profit, regional revenue, regional profit, product revenue, product margin, channel mix, target attainment, revenue vs target, and product-by-region. Use slicers/filters; clearly title every visual. Regions: " +
        regions.join(", "),
    );
  }
  if (task === "mbr") {
    const m = d.mbr;
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: `TechnoEdge Monthly Business Review — ${phase === "pre" ? "October" : "November"} 2026`,
              heading: HeadingLevel.TITLE,
            }),
            new Paragraph({
              text: "1. Performance",
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph(
              `Revenue: INR ${m.revenue}. Target: INR ${m.target}. Previous month revenue: INR ${m.previous}. Operating costs: INR ${m.cost}. All values are INR and exclude tax.`,
            ),
            new Paragraph({
              text: "2. Customers",
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph(
              `New customers: ${m.customers}. Churned customers: ${m.churn}. Qualified pipeline: INR ${m.pipeline}. Renewal conversion is a priority.`,
            ),
            new Paragraph({
              text: "3. Risks and decisions",
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph(
              "Risk: two enterprise renewals require executive sponsorship. Risk: delivery capacity is constrained for Data projects. Decisions requested: authorize two contractor positions and prioritize renewal outreach. Asha owns renewals; Ravi owns capacity planning; Maya owns pipeline quality.",
            ),
            new Paragraph({
              text: "4. Next 30 days",
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph(
              "Week 1: Asha confirms renewal plans. Week 2: Ravi onboards contractors subject to approval. Week 3: Maya audits pipeline. Week 4: leadership reviews conversion and capacity. Present a measurable action plan with owners and decision points.",
            ),
          ],
        },
      ],
    });
    zip.file("monthly-business-review.docx", await Packer.toBuffer(doc));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
export async function keyWorkbook(phase: Phase) {
  const wb = new ExcelJS.Workbook();
  const sh = wb.addWorksheet("Verified answer key");
  sh.addRow([
    "Task",
    "Question",
    "Correct option (1-based)",
    "Answer",
    "Derivation",
  ]);
  for (const [id, questions] of Object.entries(answerKey(phase)))
    questions.forEach((q, i) =>
      sh.addRow([
        catalogue[id as TaskId].title,
        i + 1,
        q.correct + 1,
        q.options[q.correct],
        q.explanation,
      ]),
    );
  sh.columns.forEach((c) => (c.width = 36));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
