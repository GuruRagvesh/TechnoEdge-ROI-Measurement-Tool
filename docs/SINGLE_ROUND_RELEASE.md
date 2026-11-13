# Single-round release (11 Nov 2026)

Status update, 13 November 2026: **live in Production.** The deployment, SharePoint
connection, email-code attendee login and PostgreSQL health have been verified.
Production Host login remains pending because neither currently allowlisted mailbox is
available to the operator. See the
[current production status and provider approval](PRODUCTION_STATUS_2026-11-13.md).

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

## Answer options (balanced-v2)

Rooms created from this release use `optionLayout: balanced-v2`. Every correct value is unchanged.
Distractors are seeded per question at independent 4-16% gaps, rounded to the answer's precision,
and options are shown in ascending order, so the correct position varies (A/B/C/D = 10/9/10/11
over the 40 questions; no task uses one position more than twice). Rooms created earlier have no
`optionLayout` and keep the original sequential order, so their saved answers still mark correctly.
The Excel export and host answer key state which layout a room uses.

## Vercel deployment (production from main)

Decision (11 Nov 2026): deploy directly to Production from `main`.
`vercel.json` builds only `main`; every other branch is skipped. On the Hobby plan the
production address `technoedge-assessment.vercel.app` is public, so access control is the
application's own: email-code sign-in, server-side host allowlist, answer keys kept on the server.

Production settings live in Vercel (Production environment). Non-secret values match
`.env.staging.example` except `APP_URL=https://technoedge-assessment.vercel.app` and
`GRAPH_STORAGE_ROOT=TechnoEdgeAssessmentROI/Production`. Secrets (`GRAPH_CLIENT_SECRET`,
`RESEND_API_KEY`, `IDENTITY_PEPPER`) are entered by the owner only.

The host allowlist lives at
`Assessment Records/TechnoEdgeAssessmentROI/Production/config/host-allowlist.json`.

## Original go-live steps

This list is retained as the release record. Current completion and open gates are in
the production status linked above.

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
