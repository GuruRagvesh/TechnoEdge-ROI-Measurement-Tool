# Phase 2 readiness — large-file checkpoint

6 November 2026. **Staging remains blocked.** Local implementation is verified; live Microsoft 365, Resend and Vercel are not. No company resources, grants, deployment or real emails were created/sent. The accepted corporate UX is unchanged.

## Implemented

- Default `EVIDENCE_MAX_MIB=25`, configurable from 1 to 250 MiB. Both templates use 25. Changes above 25 require pilot capacity review. UI and server use the same limit; oversize files are rejected before transfer and again before attachment.
- Graph-mode evidence goes directly from the browser to a server-created Microsoft upload session, in sequential 3.125 MiB chunks (multiples of 320 KiB). Only small JSON controls pass through the app. PUTs omit app cookies, bearer tokens and referrer. Graph mode rejects the old multipart application route. The local adapter keeps its working multipart transport.
- Private JSON intents persist expected size/hash, participant ownership, provider URL/expiry and preparation leases. Reload/restart resumes the existing provider session after the user reselects the same file. An expired provider session restarts safely; an already committed file can be finalized without another transfer. No capability URL is saved in browser local storage.
- Authenticated controls enforce selected task, room state and the original attempt deadline. Finalization checks actual size, reads committed bytes server-side, checks SHA-256/signature and conditionally attaches a receipt. Submitted/expired attempts and closed rooms reject new attachments. Duplicate successful completion returns the original receipt. Upload reservations preserve answer revisions.
- Lost acknowledgements recover through Microsoft status. Bounded retries honor Retry-After. Server token requests are coalesced; four network calls per adapter instance and a bounded queue limit bursts. This is not a tenant-wide distributed throttle.
- All real Graph runtimes require a dedicated site, drive, root and cohort layout. The adapter binds the exact site URL and verifies the drive is a document library belonging to that site. Entra must independently restrict runtime access through `Sites.Selected` and a write grant on that site alone; actual grants still require administrator verification.
- Authorized Graph evidence/report downloads return temporary Microsoft download links, keeping large response bodies out of Vercel. Local downloads retain binary responses. Host evidence archives use immutable owner-scoped plans split into parts of at most 100 MiB of source files, with checksum manifests. Large cohorts are not silently truncated. The lower-level ZIP builder retains a defensive 150 MiB input cap.
- Resend REST delivery, idempotent retries, OTP expiry/rate/attempt limits, two roles, owner isolation, revocation and production rejection of development credentials remain tested locally with providers mocked. Production secure cookies, HSTS, sanitized logging and optional HTTPS error collection are implemented; actual monitoring is unconfigured.

This transport avoids Vercel's documented 4.5 MB function request/response limit. See [Vercel limits](https://vercel.com/docs/functions/limitations) and [Graph upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0).

## Verification

| Check | Observed result |
| --- | --- |
| TypeScript | Passed |
| Unit/integration | 88 tests passed across 13 files |
| Browser regression | Seven scenarios passed; added split-archive navigation also passed in a focused rerun |
| Production build | Passed, including standalone asset copy |
| Large Office files | Generated XLSX with 13,000 data rows and image-bearing PPTX, each over 10 MiB and below 25 MiB; parsed back, persisted to disk, reopened through a new service and reconciled byte-for-byte in ZIP exports |
| Limit boundary | 25 MiB upload covered by browser-client unit test; 25 MiB + 1 rejected; configurable limit covered |
| Large browser workflow | Mock Microsoft direct chunks, reload/reselect resume, actual local receipts, Excel Evidence sheet and actual ZIP manifest/CRC checked |
| Archive capacity | Nine 25 MiB metadata entries split into three immutable parts; ownership and snapshot consistency checked without allocating a synthetic 225 MiB blob |
| Concurrency | Local 20-participant paired-round/recovery/export test passed; not a Microsoft load test |
| Assessment materials | Ten source packs and 40 independently recomputed answer keys retained |
| Live Graph/Resend/Vercel and real pilot | Not run; approvals/configuration missing |

The PPTX check validates package relationships, image signature and ZIP CRC; it does not certify desktop PowerPoint rendering. Microsoft endpoints and email provider are mocked in these tests. Local success does not verify tenant CORS, live CAS, Microsoft throttling, actual OTP delivery or hosted capacity.

## Remaining boundaries

Microsoft upload URLs are temporary bearer capabilities. They can remain valid after an app logout/deadline until Microsoft expiry, although the application refuses late attachment. Business upload sessions do not support the OneDrive Personal `item.fileSize` reservation option. The app enforces declared and final actual size; it cannot impose a Microsoft-side per-session hard 25 MiB quota. Administrator quota, retention and safe cleanup of abandoned/unattached blobs remain required. Never log capability URLs.

Checksum finalization reads the evidence into server memory. Excel and each ZIP part are also generated in memory, not durable background jobs; 100 MiB of ZIP source can require several times that memory. Measure simultaneous large finalizations/exports against the approved Vercel plan, including duration and retry behavior. Raising the configurable limit before that review is not approved.

Live conditional writes are a release gate: exactly one winning concurrent writer, and a direct stale HTTP `If-Match` update rejected by Microsoft. If that fails, stop rollout; do not accept last-writer-wins or widen permissions. Browser CORS, actual Microsoft upload domains, near-25 MiB resume and large direct downloads must pass on protected staging before external users.

## Missing configuration and approval

The environment remains local storage, development email capture, loopback APP_URL and private local accounts. Local secrets were preserved. The [secret-free configuration report](PHASE2_CONFIGURATION_STATUS.json) records `configurationReady=false`, `liveVerified=false`, `deploymentApproved=false`.

- Microsoft 365: approved site/library, administrator consent and selected-site grant; `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SITE_URL`, `GRAPH_SITE_ID`, `GRAPH_DRIVE_ID`; approved storage root/layout. Proposed root: `TechnoEdgeAssessmentROI/Staging`, layout `cohorts-v1`.
- Resend: approved account/sender domain, required DNS verification, `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, approved real-delivery recipients.
- Vercel: approved company project/team, protected hostname and reviewers, deployment authority, exact HTTPS APP_URL and separate hosting environment. CLI/CI may require `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`; these are operator credentials, not app/browser dependencies. Git integration is an alternative. No deployment authority is presumed.
- Runtime: strong stable staging `IDENTITY_PEPPER` (current development value is unsuitable), `STORAGE_ADAPTER=graph`, `MOCK_AUTH=false`, `LOCAL_TEST_ACCOUNTS=false`, approved exact staff registry, monitoring/alert owners. Optional external collector needs `ERROR_MONITOR_URL`/`ERROR_MONITOR_TOKEN`.

Use [.env.staging.example](../.env.staging.example) separately; do not overwrite the accepted .env.local. Follow the [final administrator checklist](FINAL_ADMIN_CHECKLIST.md) and [Microsoft 365 provisioning instructions](M365_ADMIN_APPROVAL.md).

## Next gates

After separate approvals: provision → read-only binding check → live conditional-write/concurrency probes → protected staging and explicitly approved email delivery tests → **two internal users → ten participants → larger approved corporate cohort**. Each stage covers both rounds, actual large Office uploads, practical grading, comparison, Excel/ZIP reconciliation and recovery. Production launch requires further explicit approval.

Safe local checks: `npm run typecheck`, `npm test`, `npm run materials:verify`, `npm run test:e2e`, `npm run build`, `npm run infrastructure:check`, `npm run storage:cohort-probe`.

After approval only: `npm run infrastructure:check -- --strict --live-readonly`, then `npm run storage:probe -- --confirm-live` and `npm run storage:cohort-probe -- --confirm-live`. These probes retain synthetic files in the approved staging root. Real email probes need an approved recipient and `--confirm-send`. None of these live operations were executed here.
