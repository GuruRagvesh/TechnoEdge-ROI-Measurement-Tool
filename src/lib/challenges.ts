import type { Phase, TaskId } from "./types";
export const catalogue: Record<
  TaskId,
  {
    title: string;
    subtitle: string;
    tool: string;
    brief: string;
    deliverables: string[];
    rubric: string[];
  }
> = {
  inbox: {
    title: "Inbox Inferno",
    subtitle: "Find the signal in 100 emails",
    tool: "Email · Analysis",
    brief:
      "Investigate 100 workplace emails, including 67 messages containing questions. Calculate the amount receivable by Guru, identify messages without replies, group repeated questions and prepare an FAQ Excel sheet. Use the structured email fields as the source of truth and cite message IDs in every finding.",
    deliverables: [
      "FAQ Excel workbook with repeated questions and source email IDs",
      "Receivables reconciliation, unreplied-email register and a concise summary",
    ],
    rubric: [
      "Correct Guru receivables and unreplied-message counts",
      "Accurate repeated-question grouping and traceable email IDs",
      "Useful FAQ answers, actionable follow-up owners and readable summary",
    ],
  },
  tables: {
    title: "The Hundred-Table Puzzle",
    subtitle: "100 tables. One source of truth.",
    tool: "Excel · Consolidation",
    brief:
      "Consolidate all 100 Excel tables into one clean fact table. Preserve every source row, add a source-table identifier, and summarize revenue, units and regional performance. Each source uses the same schema.",
    deliverables: [
      "Consolidated Excel workbook with 500 rows",
      "Regional summary, reconciliation and source lineage",
    ],
    rubric: [
      "No missing or duplicated source rows",
      "Correct revenue and unit aggregations",
      "Refreshable transformation and documented reconciliation",
    ],
  },
  clean: {
    title: "The Dirty Data Disaster",
    subtitle: "Turn messy records into trusted data",
    tool: "Excel · Data quality",
    brief:
      "Clean the customer extract. Trim and lowercase email, trim names, uppercase region, keep the first occurrence of each CustomerID, then reject records with missing names, email lacking @ or region outside NORTH/SOUTH/EAST/WEST. Deduplicate before validation. Supply an audit of every excluded row.",
    deliverables: [
      "Clean customer dataset",
      "Rejection log with reasons and before/after metrics",
    ],
    rubric: [
      "Deterministic duplicate and validation rules",
      "Correct accepted records and no silent data loss",
      "Auditable rejection log and consistent formatting",
    ],
  },
  dashboard: {
    title: "The Boardroom Dashboard",
    subtitle: "Make the numbers tell a story",
    tool: "Excel · Visualization",
    brief:
      "Build an executive Excel dashboard with at least 10 distinct visuals from the sales fact table. Cover monthly revenue, profit, region, product, target attainment and channel. Include filters and a written insight section. Profit = Revenue − Cost; attainment = total Revenue / total Target.",
    deliverables: [
      "Excel dashboard with 10+ visuals and interactive filters",
      "Fact table, calculation definitions and executive insights",
    ],
    rubric: [
      "Accurate KPIs and filter-aware calculations",
      "At least 10 relevant, clearly titled visuals",
      "Readable layout, useful interactions and evidence-backed insights",
    ],
  },
  mbr: {
    title: "The MBR Deadline",
    subtitle: "From report to leadership narrative",
    tool: "Word → PowerPoint",
    brief:
      "Convert the supplied monthly business review Word report into a 6–8 slide leadership deck. Include performance, variances, risks, decisions and a 30-day action plan. Preserve all financial values and cite the source sections.",
    deliverables: [
      "6–8 slide PowerPoint presentation",
      "Clear decisions, risks and 30-day action owners",
    ],
    rubric: [
      "Faithful financial figures and narrative",
      "Logical executive storyline and required content",
      "Presentation quality, source citations and actionable decisions",
    ],
  },
};
export type Question = { prompt: string; options: string[] };
type PrivateQuestion = Question & { correct: number; explanation: string };
export const regions = ["NORTH", "SOUTH", "EAST", "WEST"];
export function dataset(phase: Phase) {
  const shift = phase === "pre" ? 0 : 7;
  const emails = Array.from({ length: 100 }, (_, i) => ({
    id: `MSG-${i + 1}`,
    customer: `Account ${((i + shift) % 12) + 1}`,
    owner: ["Asha", "Ravi", "Maya", "Kiran"][i % 4],
    recipient: (i + shift) % 3 === 0 ? "Guru" : "Operations",
    priority:
      (i + shift) % 5 === 0
        ? "Urgent"
        : (i + shift) % 3 === 0
          ? "High"
          : "Normal",
    overdue: (i + shift) % 7 === 0 ? "Yes" : "No",
    value: (((i + shift) % 9) + 1) * 1250,
    due: `2026-${phase === "pre" ? "10" : "11"}-${String((i % 28) + 1).padStart(2, "0")}`,
    containsQuestion: i < 67 ? "Yes" : "No",
    replied: (i + shift) % 4 === 0 ? "No" : "Yes",
    topic:
      i < 67
        ? [
            "Batch dates",
            "Payment terms",
            "Course outline",
            "Certificate",
            "AI tools",
            "Refund policy",
          ][(i + shift) % 6]
        : "Status update",
    subject: [
      "Contract approval",
      "Renewal follow-up",
      "Delivery update",
      "Invoice query",
    ][i % 4],
  }));
  const tables = Array.from({ length: 500 }, (_, i) => ({
    table: Math.floor(i / 5) + 1,
    id: `SALE-${i + 1}`,
    region: regions[(i + shift) % 4],
    units: ((i + shift) % 13) + 1,
    revenue: (((i + shift) % 17) + 1) * 150,
  }));
  const customers = Array.from({ length: 220 }, (_, i) => ({
    id: `C${i + 1}`,
    name: (i + shift) % 19 === 0 ? "  " : ` Customer ${i + 1} `,
    email:
      (i + shift) % 17 === 0
        ? "invalid-address"
        : ` PERSON${i + 1}@EXAMPLE.COM `,
    region:
      (i + shift) % 23 === 0
        ? "unknown"
        : ` ${regions[(i + shift) % 4].toLowerCase()} `,
    value: (((i + shift) % 11) + 1) * 200,
  }));
  const dirty = [
    ...customers,
    ...customers.slice(0, 20).map((x) => ({ ...x, name: x.name.trim() })),
  ];
  const normalized = customers.map((x) => ({
    ...x,
    name: x.name.trim(),
    email: x.email.trim().toLowerCase(),
    region: x.region.trim().toUpperCase(),
  }));
  const clean = normalized.filter(
    (x) => x.name && x.email.includes("@") && regions.includes(x.region),
  );
  const sales = Array.from({ length: 360 }, (_, i) => ({
    id: i + 1,
    month: `2026-${String(Math.floor(i / 30) + 1).padStart(2, "0")}`,
    region: regions[(i + shift) % 4],
    product: ["Cloud", "Data", "Security"][(i + shift) % 3],
    channel: ["Partner", "Direct"][i % 2],
    revenue: (((i + shift) % 29) + 1) * 100,
    cost: (((i + shift) % 29) + 1) * 60,
    target: 1800,
  }));
  const mbr = {
    revenue: phase === "pre" ? 8400000 : 9100000,
    target: phase === "pre" ? 8000000 : 8750000,
    previous: phase === "pre" ? 7500000 : 8200000,
    cost: phase === "pre" ? 5880000 : 6370000,
    customers: phase === "pre" ? 42 : 47,
    churn: phase === "pre" ? 3 : 4,
    pipeline: phase === "pre" ? 12600000 : 14400000,
  };
  return { emails, tables, dirty, clean, sales, mbr };
}
const sum = <T>(rows: T[], get: (r: T) => number) =>
  rows.reduce((a, x) => a + get(x), 0);
function question(
  prompt: string,
  value: number,
  explanation: string,
  index: number,
  format: (v: number) => string = String,
): PrivateQuestion {
  const vals = [
    value,
    value + Math.max(1, Math.round(value * 0.09)),
    Math.max(0, value - Math.max(1, Math.round(value * 0.12))),
    value + Math.max(2, Math.round(value * 0.21)),
  ];
  const correct = index % 4;
  const ordered = Array.from(
    { length: 4 },
    (_, i) => vals[(i - correct + 4) % 4],
  );
  return { prompt, options: ordered.map(format), correct, explanation };
}
export function answerKey(phase: Phase): Record<TaskId, PrivateQuestion[]> {
  const d = dataset(phase);
  const urgent = d.emails.filter((x) => x.priority === "Urgent");
  const revenue = sum(d.sales, (x) => x.revenue);
  const cost = sum(d.sales, (x) => x.cost);
  const base = phase === "pre" ? 0 : 1;
  const q = (p: string, v: number, e: string, i: number) =>
    question(p, v, e, i + base);
  return {
    inbox: [
      q(
        "What is the total amount receivable by Guru?",
        sum(
          d.emails.filter((x) => x.recipient === "Guru"),
          (x) => x.value,
        ),
        "Sum Value where Recipient = Guru; each message is an independent receivable.",
        0,
      ),
      q(
        "How many messages have not received a reply?",
        d.emails.filter((x) => x.replied === "No").length,
        "Count Replied = No across all 100 messages.",
        1,
      ),
      q(
        "How many messages contain questions?",
        d.emails.filter((x) => x.containsQuestion === "Yes").length,
        "Count ContainsQuestion = Yes.",
        2,
      ),
      q(
        "How many question messages concern Payment terms?",
        d.emails.filter(
          (x) => x.containsQuestion === "Yes" && x.topic === "Payment terms",
        ).length,
        "Filter ContainsQuestion = Yes and Topic = Payment terms.",
        3,
      ),
    ],
    tables: [
      q(
        "How many fact rows should the consolidated table contain?",
        d.tables.length,
        "100 source tables × 5 rows.",
        0,
      ),
      q(
        "What is the total revenue across all tables?",
        sum(d.tables, (x) => x.revenue),
        "Sum Revenue from all 500 rows.",
        1,
      ),
      q(
        "What is the total number of units?",
        sum(d.tables, (x) => x.units),
        "Sum Units from all source tables.",
        2,
      ),
      q(
        "What is NORTH region revenue?",
        sum(
          d.tables.filter((x) => x.region === "NORTH"),
          (x) => x.revenue,
        ),
        "Filter NORTH then sum Revenue.",
        3,
      ),
    ],
    clean: [
      q(
        "How many duplicate CustomerID rows must be removed?",
        d.dirty.length - 220,
        "Keep first CustomerID: 240 − 220.",
        0,
      ),
      q(
        "How many records remain after deduplication and validation?",
        d.clean.length,
        "Apply the four published rules after keeping first CustomerID.",
        1,
      ),
      q(
        "How many unique records fail validation?",
        220 - d.clean.length,
        "Unique source count less accepted count.",
        2,
      ),
      q(
        "What is the total Value of accepted records?",
        sum(d.clean, (x) => x.value),
        "Sum Value over accepted records only.",
        3,
      ),
    ],
    dashboard: [
      q(
        "What is total revenue?",
        revenue,
        "Sum Revenue across the full sales fact table.",
        0,
      ),
      q(
        "What is total profit?",
        revenue - cost,
        "Sum Revenue minus sum Cost.",
        1,
      ),
      q(
        "What is NORTH region revenue?",
        sum(
          d.sales.filter((x) => x.region === "NORTH"),
          (x) => x.revenue,
        ),
        "Filter NORTH and sum Revenue.",
        2,
      ),
      q(
        "What is the total sales target?",
        sum(d.sales, (x) => x.target),
        "Sum Target across all 360 records.",
        3,
      ),
    ],
    mbr: [
      q(
        "What is reported revenue?",
        d.mbr.revenue,
        "Word report: Performance section.",
        0,
      ),
      q(
        "What is revenue variance against target?",
        d.mbr.revenue - d.mbr.target,
        "Revenue less Target.",
        1,
      ),
      q(
        "What is operating profit?",
        d.mbr.revenue - d.mbr.cost,
        "Revenue less Operating costs.",
        2,
      ),
      q(
        "How many new customers were acquired?",
        d.mbr.customers,
        "Word report: Customers section.",
        3,
      ),
    ],
  };
}
export function publicTasks(phase: Phase) {
  const key = answerKey(phase);
  return (Object.keys(catalogue) as TaskId[]).map((id) => ({
    id,
    ...catalogue[id],
    questions: key[id].map(({ prompt, options }) => ({ prompt, options })),
  }));
}
export function mark(
  phase: Phase,
  answers: Partial<Record<TaskId, number[]>>,
  selected: TaskId[],
) {
  const key = answerKey(phase);
  return Object.fromEntries(
    selected.map((id) => [
      id,
      (answers[id] || []).reduce(
        (score, a, i) => score + (key[id][i]?.correct === a ? 1 : 0),
        0,
      ),
    ]),
  ) as Partial<Record<TaskId, number>>;
}
