# Historical verification record

This describes the earlier Prism/OIDC release. For the current corporate workflow and large-file checkpoint (88 unit/integration tests, seven browser scenarios and production build), use [Phase 2 readiness](PHASE2_STAGING_READINESS.md). Historical counts and features below are not current release certification. Live infrastructure remains unverified.

Verified on 5–6 November 2026 in this Windows workspace, using Node 26.13, Next.js 16.4.5, Vitest and Chromium/Playwright. All datasets and participant test data are synthetic.

## Executed checks

| Check                          | Result                             | Evidence                                                                                                                               |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                     | Passed                             | `npm run typecheck`                                                                                                                    |
| Unit/integration tests         | 43 passed across 5 files           | `npm test`                                                                                                                             |
| Material reconciliation        | Both variants passed               | `npm run materials:verify`; 100 emails, 67 question messages, 100 tables / 500 rows, accepted customer counts and distinct MCQ choices |
| Production build               | Passed                             | `npm run build`, including standalone output and static/public copy step                                                               |
| Production dependency audit    | 0 advisories                       | `npm audit --omit=dev` after mail and UUID dependency updates                                                                          |
| Local adapter storage contract | Passed                             | CLI create-only, competing writes, stale-write protection and readback probe                                                           |
| Browser/API scenarios          | 6 passed                           | Local mock authentication and file storage; detailed coverage below                                                                    |
| Visual review                  | Desktop and 390px mobile inspected | Prism reference screenshots compared with actual app captures                                                                          |

## Domain and integration coverage

- Exactly three different categories required; selection locks at start; retry/resume does not reset the deadline.
- Saved answers and notes recover in a new service instance; stale revisions do not overwrite newer work.
- Repeated/concurrent submission requests return the same submission; subsequent writes are rejected.
- An exact deadline finalizes saved partial work and stamps the original cutoff; unsaved answers are not invented.
- Task completion requires four answers and evidence. Practical evaluation is restricted to submitted selected tasks.
- Automatic MCQ marking, pending practical score, final weighted grade and quality calculations.
- Pre/Post same-identity linking, inherited categories, batch/duration constraints and paired time reduction.
- Room ownership, closed-room admission and stale evaluation conflict handling; grading history retention.
- Storage write failure leaves the previous record intact. A committed evidence blob is recovered after a metadata interruption without duplication.
- Local filesystem locks, atomic writes, concurrent compare-and-swap and traversal rejection.
- Mocked Graph requests: retry bounds, 429/Retry-After, long throttling refusal, 503/network failures, 412 conflicts, conditional updates, fail-on-conflict creation, pagination and absence of bearer headers on upload-session URLs.
- Hashed opaque sessions, durable logout revocation, one-time email codes, stable email IDs and rate limits.
- Microsoft OIDC claim/state/PKCE paths tested with the provider mocked; wrong tenant and missing role rejected. Production disables mock auth and rejects local storage.
- Actual source XLSX and Word documents are parsed back. Exported workbook rows, literal-text formula-like inputs, timestamps, durable report files and evidence manifests/checksums are inspected. Missing evidence cancels an archive instead of silently omitting a file.

## Browser story

The primary scenario executes the actual UI → API → local files → UI flow:

1. Attendee requests and verifies a development email code.
2. Joins the default 60-minute Pre room, selects three tasks, starts and downloads materials.
3. Edits method notes, waits for autosave and reloads to verify persistence.
4. Injects a 503 save response, checks that the unsaved draft remains visible, retries, reloads and verifies recovery.
5. Answers twelve MCQs, uploads three evidence files and completes all three tasks.
6. Submits, observes 12/12 marking, verifies duplicate submission success and rejects a later save.
7. A separate host browser session evaluates three practical tasks and downloads Excel and ZIP exports.
8. Creates a linked Post room, starts the same verified attendee in the inherited categories despite a different requested selection, submits the different dataset answers, grades them and verifies the paired dashboard.

The API scenario also verifies anonymous/attendee authorization failures, untrusted origins, one-time code replay, code-attempt exhaustion and a forced server deadline. The responsive scenario verifies the registration page at 390px. Assessment and host views also pass horizontal overflow checks at 390px. Console page errors are checked in the main attendee flow.

The Windows sandbox does not reliably complete Playwright's automatic server-process teardown. A separate retained loopback test server is used for the final clean runner execution. This does not replace browser or API assertions; all six scenarios run against the real application. The CI workflow is supplied but has not been run on GitHub.

## Local credential account verification

The former preview interface has been removed. Browser checks cover the ordinary login form, wrong/correct passwords for both IDs, normal attendee/host routes, results and comparison charts, creation/evaluation/export screens, isolation from a real host's rooms, enforced assessment prerequisites, durable reloads, CLI-only reset and old-session invalidation. Obsolete preview pages and OTP-free login/reset/host endpoints return 404. The ordinary OTP assessment suite still passes.

Security tests cover scrypt/timing-safe server comparison, bounded failed attempts, missing/weak configuration, production rejection even with the feature flag and passwords configured, local-origin checks and synthetic classification in exports. The regular host browser test uses a trusted filesystem session fixture; Microsoft provider behavior is tested separately with the OIDC provider mocked. Actual company sign-in still requires tenant acceptance below.

## Explicitly unverified

- Live Microsoft tenant sign-in, app-role assignment, consent, SharePoint folder/file writes, conditional-write semantics and tenant throttling. No tenant credentials or dedicated library were supplied.
- Real SMTP delivery, deliverability and tenant-specific transport policies.
- The real-library `storage:probe` race and direct stale-HTTP-write check; only the local probe and mocked Graph contracts have run.
- Production load capacity, tenant disaster recovery, malware policy behavior and psychometric equivalence of the synthetic variants.
- Docker image execution. The Dockerfile and deployment instructions are supplied; this session verified the Next production build directly.
- A supplementary standalone production-server smoke test was rejected by the execution environment: approval was required but approval prompting was disabled. It is not counted as a passed check.

The application is a tested local implementation with a production-oriented Microsoft 365 adapter and configuration path. It has not been certified or deployed as a live Microsoft 365 production service. Follow the tenant acceptance checklist before real use.

