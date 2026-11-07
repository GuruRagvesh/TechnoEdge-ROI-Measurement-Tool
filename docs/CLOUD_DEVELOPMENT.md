# Work from another computer

The target is the existing private repository **GuruRagvesh/TechnoEdge-ROI-Measurement-Tool**. A GitHub repository stores code; it does not host the assessment application by itself. No public/staging deployment or live company integration has been approved.

## Private Codespaces development

After the audited source is pushed, open the repository → Code → Codespaces → create a workspace on main. Check your account's available compute quota before creating it. The included `.devcontainer/devcontainer.json` installs dependencies and creates a fresh, ignored development environment. No Codespace has been created or live cloud behavior verified by the local checks.

In its terminal:

```sh
npm run dev:cloud
```

Use the Ports panel to open port 3000 in a browser. Keep its visibility **Private**; do not make a development server public or organization-wide. Sign into the same GitHub account from your home computer, reopen the same Codespace, start the server if necessary, and open the private forwarded port. A stopped workspace is not an always-on website.

Cloud development deliberately disables the loopback-only DEMO001/HOST001 password accounts. Use normal name/email/code sign-in. Email is captured privately instead of delivered. After requesting a code in the app, use the private terminal:

```sh
npm run cloud:otp -- your-test-email@example.com
```

For Host access, the workspace owner can add their exact test email through `npm run hosts -- add your-test-email@example.com`, then sign in with a newly requested code. Use a separate synthetic email for Attendee testing. No web interface can assign the role. The captured-code CLI is development-only; production OTP restrictions and password-bypass rejection are unchanged.

The new cloud identity pepper is generated once and `.env.local` is never overwritten by repeated setup. Files are isolated in `.data/cloud-development`; no existing local participant records or credentials are uploaded. The forwarded origin is derived from GitHub environment metadata; exact origin checks remain enabled. Do not add company Graph/Resend secrets or real participant records to this development environment.

Commit/push code changes before switching workspaces. Ignored `.env.local` and `.data` survive only with that workspace; they are not company backups and may be lost if the Codespace is deleted or expires. GitHub's own access gate protects the port; captured-code development is not a staging authentication solution. See [GitHub private forwarding](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace).

## Stable hosted application

A protected Vercel staging website remains a separate approval gate. It must use real OTP, dedicated SharePoint storage, secure production configuration and the approved 2 → 10 → larger cohort pilot. Development capture/local storage cannot be substituted for that release. Follow [the administrator checklist](FINAL_ADMIN_CHECKLIST.md).

## Windows Git authentication blocker

Git is installed and origin is configured. This sandbox cannot read the normal user's GitHub CLI configuration/Windows credentials. Observed errors were `SEC_E_NO_CREDENTIALS (0x8009030e)`, inability to persist credentials with `wincredman`, and private-repository authentication failure. Switching Git's TLS backend retained certificate verification but did not solve credential isolation. The connector also returned 404 for this private repository; the signed-in browser verified that the repository exists and is private.

Authenticate in normal Windows PowerShell using `gh auth login --hostname github.com --git-protocol https --web`, then `gh auth setup-git`. No token should be pasted into chat or source. If sandbox isolation persists, push the reviewed local commit from that normal PowerShell window. Do not upload the whole application folder through a file picker: it contains ignored development secrets and runtime files. No push has been claimed successful without remote verification.
