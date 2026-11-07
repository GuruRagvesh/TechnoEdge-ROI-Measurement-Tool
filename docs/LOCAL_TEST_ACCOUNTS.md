# Local credential accounts

Open **http://127.0.0.1:3000/login**. The ordinary login accepts an email address or User ID. There are no test-account buttons, preview pages, developer banners or navigation shortcuts.

| User ID   | Name         | Normal destination | Private server environment setting |
| --------- | ------------ | ------------------ | ---------------------------------- |
| `DEMO001` | Arjun Mehta  | `/attendee`        | `TEST_ATTENDEE_PASSWORD`           |
| `HOST001` | Priya Sharma | `/host`            | `TEST_HOST_PASSWORD`               |

Enter an ID, click Continue, and enter its password. Passwords must be configured privately in `.env.local`; no shared or hardcoded application password exists. Use at least 12 characters. The current workspace has cryptographically generated passwords in that ignored file. Passwords are never returned by the API or embedded in client JavaScript.

## Enable locally

```dotenv
APP_URL=http://127.0.0.1:3000
STORAGE_ADAPTER=local
LOCAL_TEST_ACCOUNTS=true
TEST_ATTENDEE_PASSWORD=
TEST_HOST_PASSWORD=
```

Set the two secret values privately, then run `npm run dev`. The developer server binds to loopback. Access also requires the exact configured Host, protocol and port, allowing Next's internal localhost normalization. Do not forward the developer server to an untrusted network.

The actual server runtime must be `NODE_ENV=development`. The account endpoint rejects production, other runtimes, Graph storage, disabled flags and non-loopback origins. Production rejects these IDs even if passwords and the flag are accidentally configured. Old OTP-free endpoints and preview pages are removed. Old preview/development sessions are invalidated.

Server-side sign-in derives both candidate and configured passwords with scrypt and compares fixed-size buffers with a timing-safe comparison. Five failed attempts lock the account for 15 minutes; a successful login resets the counter. Missing or weak password configuration does not permit sign-in. Authenticated sessions are the same opaque, HttpOnly sessions used elsewhere in the application, with an internal classification and isolated storage generation.

## Actual workflows

Regular email entry continues through name collection and OTP verification. Authorized hosts use the same OTP flow; the server registry assigns permission. Local password accounts are independent of email delivery: `MOCK_AUTH=false` plus SMTP configuration tests real delivery; with mock email, the local outbox stores codes for development tools. The website has no mailbox-reading shortcut.

Both local accounts render the same components, use the same routes/APIs and call the same assessment/grading/export services as real users. Historical Base Camp/Summit records provide populated results and charts. New assessments require genuine enrollment, selection of three challenges, server timing, answers, evidence and submission. A linked new Summit cannot start until its new baseline is submitted. No page visit resets an attempt or bypasses those prerequisites.

The host has existing rooms, participants in several attendance states, pending evaluations and working report/evidence downloads. Create new company/cohort programs and join their rooms through the usual room-code flow to repeat an assessment with another selection of tasks.

## Isolation and internal labeling

All account records and newly created rooms live under `local-test-accounts/generations/<uuid>/`. Real participant records and Microsoft 365 data are outside that namespace. Knowing a real room ID does not give a local account access to it. Storage identities/room metadata and Excel/ZIP exports carry the `synthetic-test` classification. Names, notes and feedback in the normal website do not carry developer labels.

## Reset from the terminal

```powershell
npm run reset:test-accounts
```

The command requires the explicitly enabled local configuration. It creates a fresh sample generation and invalidates older local-account sessions, without deleting or altering real assessments. Password values remain unchanged. No reset API or website button exists. Old generations are retained locally for inspection; this is not a destructive filesystem purge.

## Checks

`npm test`, `npm run test:e2e`, `npm run typecheck` and `npm run build` cover the regular OTP flow and credential account flow. Browser checks include incorrect passwords, normal routes and controls, real exports, room creation, prerequisite enforcement, reload persistence, isolation, CLI reset and absent developer UI. Production and disabled-configuration rejection are exercised in unit/API tests without requiring tenant credentials.

