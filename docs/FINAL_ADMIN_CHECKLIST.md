# Final administrator checklist

6 November 2026. **Review only: no provisioning, real email activation or deployment is authorized.** Every unchecked item needs manual approval/configuration or live verification.

## Microsoft 365 administrator

- [ ] Approve/create a private company-owned **TechnoEdge Assessment ROI** site: `https://<approved-tenant>.sharepoint.com/sites/TechnoEdgeAssessmentROI`, library **Assessment Records**. Actual tenant/site/library are not approved yet. Do not substitute personal OneDrive.
- [ ] Assign primary/backup owners, version history, retention/recovery, quota and malware/file-type policy. Check required-checkout/labels allow app-only conditional updates.
- [ ] Approve a single-tenant runtime Entra app with **Microsoft Graph application `Sites.Selected` only**, administrator consent and **write** on the dedicated site alone. Review that there are no other-site grants or broad `Files.*.All` / `Sites.*.All` runtime permissions. Use a separate authorized admin context for the grant; never deploy its credential.
- [ ] Deliver tenant ID, client ID, rotating client-secret **value**, composite site ID, exact site URL and Assessment Records drive ID through the approved secret store. Current runtime supports client secrets, not certificate/workload identity.
- [ ] Approve `GRAPH_STORAGE_ROOT=TechnoEdgeAssessmentROI/Staging`, `GRAPH_LAYOUT=cohorts-v1` and separate staging/production storage. Existing data needs a backed-up explicit migration.
- [ ] Review private upload-intent/capability storage and safe cleanup of abandoned/oversized/unattached blobs. App deadlines block attachment; Microsoft capabilities may remain usable until provider expiry. App validation is not a Microsoft Business per-session hard quota.
- [ ] After approval, run read-only target binding followed by explicitly authorized write probes. Require one CAS winner and direct stale `If-Match` rejection at Microsoft. Use an administrator-controlled second-site access test to prove Entra scope; mock tests cannot certify actual grants.

Exact steps and reviewed grant request: [Microsoft 365 setup](M365_ADMIN_APPROVAL.md). Runtime needs no delegated attendee token, mail permission or tenant-wide file access. See [Microsoft selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview).

## Email/domain administrator — Resend pending approval

- [ ] Approve a company-owned Resend account, sender domain/subdomain and address. Verify provider-required SPF/DKIM records; review DMARC with the domain owner without blindly replacing existing DNS policies.
- [ ] Configure `MAIL_PROVIDER=resend`, a sending API key scoped to the approved domain where available, and `EMAIL_FROM` in hosting secrets. Assign rotation and bounce/complaint/support owners.
- [ ] Separately approve live delivery and probe recipients. Verify actual receipt/delay/spam placement in Gmail, Outlook and corporate inboxes. API acceptance alone does not prove delivery.
- [ ] Test ten-minute expiry, one-use codes, five verification attempts, six requests/hour per address with 30-second cooldown, configured IP/global hourly limits, replay denial and logout revocation. Verify proxy IP attribution on staging.

See [Resend sender domains](https://resend.com/docs/dashboard/domains/introduction). No live email has been activated.

## Application owner and Vercel administrator — no deployment approval yet

- [ ] Approve the company team/project, stable HTTPS staging hostname, reviewers and deployment protection on **all deployment aliases**, not just the custom domain. Set project root to this app. Do not enable automatic public/production deployment.
- [ ] Configure the separate staging environment from `.env.staging.example`: exact HTTPS APP_URL; Graph identifiers/secrets/root/layout; `STORAGE_ADAPTER=graph`; `MOCK_AUTH=false`; `LOCAL_TEST_ACCOUNTS=false`; Resend settings; strong stable IDENTITY_PEPPER; `EVIDENCE_MAX_MIB=25`; reviewed OTP limits. No secrets under NEXT_PUBLIC variables. No local passwords or mock mailbox in staging.
- [ ] Seed only approved exact host addresses through the trusted operator CLI. Verify revocation on an existing session. Attendees cannot self-assign Host.
- [ ] Approve deployment authority through Git integration or operator/CI. CLI/CI credentials, if needed: VERCEL_ORG_ID, VERCEL_PROJECT_ID, VERCEL_TOKEN, held outside app/browser code. **Obtain explicit deployment approval before deploying.**
- [ ] Assign monitoring/alert/log-retention owners and configure platform monitoring/optional HTTPS collector. Verify alerts with a controlled failure. Do not log email codes, private addresses, credentials or capability URLs.
- [ ] Verify plan memory/duration/concurrency for simultaneous 25 MiB checksum finalizations and 100 MiB-source ZIP parts. Upload/download bytes bypass functions; server verification and report/ZIP generation still consume memory. No Vercel large-body override is assumed.
- [ ] On approved protected staging verify Secure/HttpOnly/SameSite cookies, CSRF/origin checks, uncached private responses, HTTPS headers, disabled development credentials/endpoints, two roles, ownership/company isolation, protected answer keys and one attempt per room.

## Live tests and pilot — stop between gates

- [ ] Run `npm run infrastructure:check -- --strict --live-readonly`. This proves only readable site/library binding, not write, OTP or pilot readiness.
- [ ] Authorize `storage:probe` and `storage:cohort-probe` with `--confirm-live`. Reconcile retained synthetic records, CAS outcomes, submission idempotency and exports in the approved root before any cleanup.
- [ ] Test actual XLSX/PPTX near 25 MiB direct from staging: CORS/allowed Microsoft domains, reload/reselect, app restart, provider expiry, lost acknowledgement, throttling, interrupted receipt save and post-deadline/submission/room-close rejection. Reconcile actual stored bytes and receipts.
- [ ] Verify individual evidence, Excel and multi-part ZIP downloads; cross-host/attendee denial; memory/duration/restart behavior; exact manifest contents. Open realistic documents in desktop Office. No silent omissions.
- [ ] **Two internal users:** Host → Base Camp → real uploads → submission → grading → Summit → grading → personal comparison → Excel/ZIP. Verify actual OTP receipt and durable records after restart.
- [ ] **Ten participants:** repeat both rounds with simultaneous saves/submissions, mobile/reconnect and a second client cohort for isolation. Reconcile all records, scores and files.
- [ ] **Larger approved corporate cohort:** advance only after previous gates pass. Record release, cohort size, latency/retries, delivery success, failed/lost/duplicate writes and recovery. Lost answers, authorization failures or omitted evidence block progression.
- [ ] Verify backup/version recovery, incident ownership and final security/product/administrator sign-offs. Production launch requires separate explicit approval.

Current result: **local checks passed; live infrastructure, protected staging and real pilot remain pending.** [Verified readiness report and operational limits](PHASE2_STAGING_READINESS.md).
