# TechnoEdge Assessment ROI

A working Next.js / TypeScript assessment application with separate Host and Attendee portals. Durable records are individual JSON documents in a dedicated SharePoint library, accessed server-side through Microsoft Graph. No database and no concurrently edited Excel workbook are used. A local disk adapter runs the same workflows without Microsoft 365.

Current checkpoint: configurable **25 MiB direct resumable SharePoint evidence uploads**, 91 unit/integration tests and seven browser scenarios passed locally, production build passed. Live infrastructure is unverified and deployment remains unauthorized. See the [readiness report](docs/PHASE2_STAGING_READINESS.md) and [administrator checklist](docs/FINAL_ADMIN_CHECKLIST.md).

The [complete visual walkthrough](docs/final-review/index.html) contains 27 actual application screenshots, including all five challenges, submission, results, both portals and mobile. For access from another computer, see [private cloud development](docs/CLOUD_DEVELOPMENT.md). Codespaces configuration is provided; live cloud execution and protected staging remain unverified.

The approved Corporate UX review refines Prism Studio into a navy corporate interface with exactly three sidebar destinations per role, readable cards and responsive layouts. AI Time-Back 360 supplies the four measurement dimensions and paired impact views. The earlier Python pilots informed server deadlines, opaque identities, grading and export workflows; their RAM stores, host keys and browser-only persistence were replaced. See [reference integration](docs/REFERENCE_INTEGRATION.md).

## Run locally

Use Node 22.22+ (this build was verified with Node 26.13) and npm.

```powershell
cd <path-to-this-folder>
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Use this exact origin; request origins are checked against `APP_URL`.

The homepage introduces the platform. Open `/login` and enter an email address (Microsoft, Google or another valid domain). Both roles verify a six-digit email code; the server registry assigns Host permission. No user can select or request that role.

For local account testing, set `LOCAL_TEST_ACCOUNTS=true` and privately configure `TEST_ATTENDEE_PASSWORD` and `TEST_HOST_PASSWORD` in `.env.local` (at least 12 characters each). Enter **DEMO001** (Arjun Mehta) or **HOST001** (Priya Sharma), then the corresponding password. Both use the normal `/attendee` and `/host` portals. There are no special pages, developer controls, banners, reset buttons or workflow shortcuts.

Sample records are isolated under `local-test-accounts/generations/<uuid>/` and marked `synthetic-test` in storage and internal exports. The accounts have completed Base Camp/Summit history, ordinary new assessments, multiple participants, pending evaluations, evidence and Excel reports. Starting a new assessment requires the actual three-of-five selection, timer, evidence, submission and grading flow.

Local accounts require `NODE_ENV=development`, the explicit flag, local storage and a configured loopback HTTP origin. Production always rejects them. The passwords never enter client bundles. See [local account setup](docs/LOCAL_TEST_ACCOUNTS.md).

For actual email delivery during local testing, configure SMTP and set `MOCK_AUTH=false`; local password accounts remain independently gated. With mock email enabled, codes are recorded in the local development outbox rather than exposed through a website control. The default room remains **AI Productivity Benchmark · Pre-AI · 60 minutes**.

Restore only the local sample records with `npm run reset:test-accounts`. This is an operator CLI, not a website feature, and leaves real participant data untouched.

## What works

- Unified verified email sign-in; durable opaque sessions and logout revocation. Stable keyed email identities link both phases.
- Server-owned exact-email host registry; every authenticated request rechecks permission, including revocation. Provision through the trusted `npm run hosts -- add|remove email` CLI only.
- Host creates a company/cohort program with two fixed 60-minute rooms: Base Camp open and Summit closed. Creation retries reuse the same request ID and recover partial writes. Hosts open/close room admission; locked attempts cannot be reopened. The legacy default room remains shared among authorized hosts.
- Five independent challenges, select exactly three, four result MCQs each, materials and evidence for every category.
- Separate Pre/Post datasets. Post rooms inherit the baseline batch and duration; each attendee's three categories are inherited from their own submitted baseline.
- Explicit confirmed join durably starts the server deadline before task selection. Validation alone starts no timer. Rejoining resumes the original attempt/deadline; expired and submitted attempts reject re-entry. Debounced serialized autosave, reload/resume, explicit save errors, stale-tab protection, one-way submission lock and deterministic MCQ marking.
- Corporate practical rubric: completeness /3, accuracy /3, presentation /2. Evaluation edits reject stale versions and retain grading history in the participant record. Historical records retain their original /5 dimensions.
- New scoring version `corporate-60-v1`: each task awards 4 MCQs × 3 + 8 practical = 20 marks; three tasks total 60. Unversioned historical records mean `legacy-100` and retain their original 40% MCQ / 60% practical scoring. No score conversion occurs. Final score requires all three evaluations; cross-version pairs are excluded.
- Attendee scores, completion, elapsed time, accuracy, quality and paired improvements. Host views separate observed changes from assumption-based financial ROI.
- Actual XLSX exports with participant rows, answers, marks, timestamps, evidence checksums, comparisons and an editable modeled ROI sheet. Each generated report is saved as a new SharePoint file.
- Host-authorized evidence ZIP archives and individual downloads with checksum verification.

## Verify

```powershell
npm run typecheck
npm test
npm run materials:verify
npm run build
npx playwright install chromium
npm run test:e2e
```

Tests use local/mock services and synthetic data. Playwright starts a loopback-only development server when one is not already running. It uses a separate test data directory. See [verification evidence](docs/CORPORATE_UX_ACCEPTANCE.md) for exactly what was exercised and what still needs a tenant.

## Challenge materials

| Category             | Generated materials                                                       | Required work                                                                  |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Inbox Inferno        | 100 long `.eml` emails plus structured CSV; 67 messages contain questions | Guru receivables, unreplied register, repeated questions and FAQ workbook      |
| Hundred-Table Puzzle | XLSX with 100 actual Excel tables across 100 sheets, 500 source rows      | One consolidated fact table, source lineage and reconciliation                 |
| Dirty Data Disaster  | 240-row dirty customer CSV, including 20 duplicate IDs                    | Deterministic normalization, deduplication, validation and rejection audit     |
| Boardroom Dashboard  | 360-row Excel sales fact table and visual brief                           | Excel dashboard with at least 10 visuals, filters and executive insights       |
| MBR Deadline         | Actual Word `.docx` monthly report                                        | 6–8 slide PowerPoint with accurate figures, risks, decisions and action owners |

Answer keys are computed from the deterministic source datasets and are available only to authorized hosts. Independent material verification reads back the Excel source files and reconciles totals. Dataset variants have matching structures and task demands; psychometric equivalence and cohort calibration have not been established.

## Production setup and deployment

Follow [Microsoft Entra and SharePoint setup](docs/MICROSOFT_365_SETUP.md), then [deployment](docs/DEPLOYMENT.md). Credentials remain exclusively in the server environment. There is no `NEXT_PUBLIC_` credential.

Production requires Graph storage, HTTPS, a server-provisioned host registry, a real TLS SMTP relay, and a strong stable identity pepper. The server fails closed for a production configuration using mock auth or local storage. SMTP delivery and SharePoint writes require your tenant configuration and must be acceptance-tested before a real cohort is enrolled.

## Storage and recovery

```text
rooms/<room-id>/room.json
rooms/<room-id>/participants/<stable-attendee-id>.json
rooms/<room-id>/evidence/<stable-attendee-id>/<content-hash>-<task>.<extension>
rooms/<room-id>/upload-intents/<uuid>.json
rooms/<room-id>/reports/<timestamp>-<uuid>.xlsx
attendees/<stable-attendee-id>/rooms.json
hosts/<host-id>/rooms.json
auth/sessions/<sha256-token>.json
auth/challenges/<random-id>.json
config/host-allowlist.json
identities/<stable-email-id>.json
programs/<program-id>/program.json
auth/rates/<key>.json
```

JSON read/modify/write operations use ETag compare-and-swap with bounded retries. Local writes use a heartbeat file lock plus atomic rename. Graph updates send `If-Match`; creates use upload sessions with conflict behavior `fail`. Reads recheck metadata to avoid combining an old content revision with a new ETag. Throttling honors `Retry-After`, uses jitter when absent and fails retriably rather than shortening a long requested delay. No unbounded retries run inside HTTP requests.

Uploads are content-addressed. If the blob commits but participant metadata does not, the same upload can be retried without duplicating evidence. If a deadline passes during upload, the file is not linked after the deadline. Upload intents identify unreferenced blobs for operator review. Reports are immutable snapshots; no workbook receives concurrent writes.

```powershell
npm run storage:probe
npm run recover -- --room=ROOM_ID
```

The probe tests competing writes, stale preconditions and create-only behavior; on Graph it also sends a direct stale HTTP write to verify Microsoft's enforcement. Run this against the actual dedicated library before production. Recovery rebuilds host/attendee indexes for a specified room, finalizes expired attempts and reports missing evidence or unreferenced upload intents. It does not delete or retroactively attach evidence. See [operations](docs/OPERATIONS.md).

## Code map

- `src/app`: responsive portals and a Node-runtime API route dispatcher.
- `src/lib/storage.ts`: local and Graph storage adapters; ETags, locks, retries.
- `src/lib/auth.ts`, `identity.ts`: email codes, server-owned role registry and durable sessions.
- `src/lib/assessment.ts`: enrollment, timers, selection, save, evidence, submit, evaluate.
- `src/lib/challenges.ts`, `materials.ts`: task briefs, synthetic datasets, keys and Office materials.
- `src/lib/metrics.ts`, `batches.ts`, `reports.ts`: measurements, cohort summaries and exports.
- `tests`, `e2e`: automated domain, storage, auth, Office and browser verification.
- `scripts`: material reconciliation, local account reset, storage contract probe and recovery.

Material definitions are versioned with the application. Do not change dataset or answer-key code while a cohort is taking an assessment; finish rooms under their original release. A future release should persist a dedicated material version per room before offering arbitrary historical assessment versions.

