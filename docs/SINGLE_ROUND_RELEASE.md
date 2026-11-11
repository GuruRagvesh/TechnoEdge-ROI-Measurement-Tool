# Single-round release (11 Nov 2026)

Status: **code complete and verified locally. NOT LIVE.** No hosted deployment, SharePoint
connection or real OTP email has been verified.

## What changed

`ASSESSMENT_MODE` (default `single`) makes every new room one 60-minute round:

- Host "Create room" makes one open room (Base Camp pack and its 20 keys). No Summit room.
- Attendee, join, test and host pages drop Pre/Post, comparison and modeled-ROI content.
- The shared "Open cohort" room is no longer listed or joinable; a host-issued room code is required.
- No-evidence policy: a selected challenge with no upload gets 0/8 practical at submit or expiry.
- Each answer records the server time it was last changed.
- Registration record keeps `createdAt`, `verifiedAt`, `lastLoginAt`.
- Excel export for single-round rooms: Participants, Question Answers, Challenge Results,
  Overall Results, Evidence Log, Data Dictionary. Totals show "Pending" until graded.
- A failed autosave retries automatically.

`ASSESSMENT_MODE=paired` restores Base Camp + Summit creation. Existing paired rooms, records,
exports and the legacy 100-point scoring are untouched in either mode.

## Known issue to decide before real participants

Correct MCQ options follow a fixed pattern (`src/lib/challenges.ts`, `correct = index % 4`):
in every Base Camp challenge the right answers are options 1, 2, 3, 4 in order, and the correct
value is always the second-smallest option. Values are right; positions are guessable.

## Go-live steps (all need account owners)

1. Push this branch; let GitHub Actions run.
2. Microsoft 365: confirm the assessment site and `Assessment Records` library; confirm the
   Entra app, `Sites.Selected` consent and the site-scoped write grant; create a client secret.
3. Resend: verify the sender domain (DNS) and create an API key.
4. Vercel project, access-protected, with these variables:
   `APP_URL`, `STORAGE_ADAPTER=graph`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`,
   `GRAPH_CLIENT_SECRET`, `GRAPH_SITE_URL`, `GRAPH_SITE_ID`, `GRAPH_DRIVE_ID`,
   `GRAPH_STORAGE_ROOT`, `GRAPH_LAYOUT=cohorts-v1`, `MAIL_PROVIDER=resend`, `RESEND_API_KEY`,
   `EMAIL_FROM`, `IDENTITY_PEPPER` (32+ random characters), `MOCK_AUTH=false`,
   `LOCAL_TEST_ACCOUNTS=false`, `ASSESSMENT_MODE=single`.
5. `npm run infrastructure:check`, `npm run storage:probe`, `npm run email:probe`.
6. `npm run hosts -- add <host email>` against the live storage.
7. `/api/health` must return ready; then run one host + two participants end to end.
