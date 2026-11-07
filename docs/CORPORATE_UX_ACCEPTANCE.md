# Corporate UX implementation and acceptance

Implemented in the existing Next.js application on 6 November 2026. No public deployment was performed. This record supersedes the earlier Prism/OIDC verification notes.

For the later infrastructure/large-file checkpoint, use [Phase 2 readiness](PHASE2_STAGING_READINESS.md): 88 unit/integration tests, seven browser scenarios and production build passed locally. Live infrastructure and staging deployment remain pending.

## Local acceptance

Run `npm ci`, copy `.env.example` to `.env.local`, configure private local passwords and a stable identity pepper, then `npm run dev`. Open **http://127.0.0.1:3000/login**. Existing workspace passwords remain unchanged.

- `DEMO001`: Arjun Mehta, ordinary Attendee portal.
- `HOST001`: Priya Sharma, ordinary Host portal.
- Passwords are private `TEST_ATTENDEE_PASSWORD` and `TEST_HOST_PASSWORD` environment values, never browser-delivered credentials.
- Local accounts require development runtime, local storage, an explicit flag and the configured loopback origin. Production always rejects them. No Preview, Page Explorer, demo buttons or web reset controls exist.
- `npm run seed:demo` now ensures the isolated account fixtures without changing existing records. Historical /100 records remain, with an additional corporate /60 completed pair for Orion Finance. `npm run reset:test-accounts` creates a fresh isolated generation and invalidates old local-account sessions; real records are untouched.

## Implemented behavior

Both roles use name/email/OTP. Google, Microsoft and other valid email addresses follow the same workflow. The exact-email host registry is server-owned; a supplied role, display name or matching domain cannot grant permission. Host permission is rechecked on each authenticated request, including existing sessions. Provision/remove staff only through `npm run hosts -- add|remove email@company.com` from a trusted operator shell. The old Microsoft sign-in endpoint is retired.

Hosts create a company/cohort program using only those two fields. The server fixes five challenges, scoring and 60-minute durations, creates linked Base Camp and Summit rooms, and initially closes Summit. A stable creation request ID recovers partial creation and prevents duplicate room pairs on retry. Existing standalone rooms and participant records are preserved. Closing/reopening room admission never unlocks a submitted or expired attempt.

Room validation starts no clock. Explicit confirmation creates the attempt with a durable server start/deadline before challenge selection. Duplicate joins and reconnects retain that deadline. Expiry can occur while selecting challenges. Submitted and expired attempts reject re-entry and remain view-only; invalid, closed, expired and submitted cases have distinct server codes and messages. No exceptional attempt-reopening feature is enabled.

Participants select three categories; Summit derives the same three from their complete submitted baseline. The source datasets differ between phases. Autosave is serialized and revision-protected; saved work resumes after reload. Failed saves remain visibly unsaved and can be retried. Evidence is checksum-verified and content-addressed. Submission review is a reloadable page, and duplicate submissions retain one receipt.

`corporate-60-v1` awards 12 MCQ marks plus 8 practical marks per task, for 60 total. The practical rubric is completeness /3, accuracy /3, presentation /2. Unversioned historical records resolve to `legacy-100`; their original 40% MCQ / 60% practical calculation and /5 rubric remain. The app never converts historical results. Final grades require all three practical evaluations. Comparisons require complete, finalized, same-identity, same-category and same-scoring-version pairs.

Excel workbooks contain scoring version, maximum score, MCQ marks, practical dimensions, task answers, timestamps, completion, evidence index and matched comparisons. Workbook and evidence ZIP downloads are saved as new report snapshots. Observed time/score/quality changes are displayed separately from modeled financial ROI; no causal or realized-savings claim is made.

## Page access

| Area | Routes / workflow |
| --- | --- |
| Public | `/`, `/login`, `/verify` |
| Attendee sidebar | `/attendee`, `/attendee/assessments`, `/attendee/results` |
| Join and unavailable states | `/attendee/join`, `/attendee/room-unavailable` |
| Selection and five task templates | `/attendee/rooms/{roomId}`; server attempt state controls access and selected task tabs |
| Reloadable attempt views | `/attendee/attempt/{roomId}/choose`, `/attendee/attempt/{roomId}/review`, `/attendee/attempt/{roomId}/submitted`; visiting a URL never advances the attempt |
| Program comparison | `/attendee/results/{programId}/comparison`; only finalized eligible pairs display a comparison |
| Host sidebar | `/host`, `/host/assessments`, `/host/reports` |
| Create / manage | `/host/assessments/new`, `/host/assessments/{programId}` |
| Monitor / evaluate | `/host/rooms/{roomId}/monitor`, `/host/rooms/{roomId}/evaluate/{participantId}` |
| Exports | `/host/reports/export` |

The role-specific sidebars each contain exactly three destinations. The assessment workspace has a sticky countdown, per-task answer/evidence progress and last durable save time. Host actions and statistics are labeled by their actual scope. Mobile layouts and table scrolling are checked at 390px. Business content is readable without a screen-explorer overlay.

## Executed verification

- TypeScript check and Next production build, including standalone assets.
- **54 unit/integration tests across 7 files**: host registry and revocation, OTP replay/attempt/source limits, local credential production rejection, ownership, duplicate joins/submissions, selection-time expiry, stale revisions/grades, interrupted indexes/program creation, disk restart recovery, storage/Graph failures, versioned scoring and exports.
- **5 browser/API scenarios**: actual host email OTP through the server registry; paired cohort creation; explicit attendee join; pre-selection reload; download; autosave reload and injected 503 retry; twelve answers/three uploads in each round; submission-review reload; both practical evaluations; eligible comparison; Excel/ZIP parsing; local account isolation/reset; CSRF, replay, brute-force bounds and deadlines; absent obsolete routes and developer UI.
- `materials:verify` independently parses all **10 delivered packs** and recomputes all **40 MCQ keys** from their CSV, Excel and Word content. It verifies real 100-table workbooks, 100-email packs, published cleaning rules, sales aggregates, Word financial/customer values and different phase results. No incomplete challenge remains in this content check. Difficulty equivalence still needs a real participant pilot.
- Local `storage:probe` verifies competing writes, stale preconditions, create-only behavior and readback. Host-registry CLI add/remove was exercised in isolated local storage.

The browser runner uses a retained loopback test server in this Windows environment to avoid a framework process-teardown hang. It operates on `.test-work/e2e`, separate from acceptance records. Browser screenshots are captured under `.test-work`; they are evidence of the actual application, not the reference concept.

## Required before public deployment

Live Microsoft 365 credentials/site grants and a real OTP sender have not been configured or verified here. Local results use the local adapter and captured development mail; mocked Graph tests are not a tenant acceptance test.

Verify real OTP delivery to corporate and external addresses, provision the exact host registry, run `storage:probe` against the dedicated SharePoint library, verify a real document upload/reload/export, and complete a real-world Base Camp/Summit pilot before publishing. Measure classroom/NAT concurrency and Graph throttling, confirm retention/backups and deployment ingress limits, and inspect actual quality/difficulty equivalence. Deployment remains private until these checks pass.

Ingress must replace `X-Forwarded-For` with the trusted client address; direct untrusted proxy headers must not be forwarded unchanged. Code issuance has per-email, source and global hourly limits. Set `OTP_IP_HOURLY_LIMIT` and `EMAIL_HOURLY_LIMIT` for the expected corporate NAT/cohort size, and enforce ingress abuse controls. These limits are operational bounds, not proof against a distributed denial of service.

Existing Microsoft OIDC host ownership IDs are not silently reassigned to email identities. If such production records exist, an administrator must back them up and perform a deliberate owner-ID migration before that staff member can manage them through OTP. Local `HOST001` ownership is unchanged. No live OIDC tenant had been connected in this workspace.

See [Microsoft 365 and email setup](MICROSOFT_365_SETUP.md), [deployment](DEPLOYMENT.md), and [operations](OPERATIONS.md).
