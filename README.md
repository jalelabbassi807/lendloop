# LendLoop

A tool-lending board for a neighborhood. People list tools they're happy to lend, ask to borrow other people's, and n8n sends the notifications and the daily "please bring it back" reminders.

Next.js 16 (App Router), Clerk, Convex, n8n, TypeScript, Tailwind.

## Pages

- `/` is public: tagline, the tools available right now (name and category only, nothing about the owner) and a sign-in button.
- `/app` needs an account. Tabs:
  - Browse tools: all tools with availability, a category filter, and a request form with a date range.
  - My listings: add, edit, delete your tools.
  - My requests: what you asked to borrow. Pending ones can be cancelled.
  - Incoming requests: requests for your tools. Approve, decline, mark returned.
  - Admin (admins only): every loan, remove any listing, mark a lender as "Trusted Lender", and an Automation page listing failed deliveries and n8n errors (with Retry / Dismiss).

Loans also show the last automation that went to you, like "Reminder sent 2 days ago".

## Code layout

```
convex/
  schema.ts          users, tools, loans, webhookDeliveries, automationEvents
  lib/auth.ts        requireUser / requireAdmin
  lib/hmac.ts        signing + verification for the n8n requests
  users.ts tools.ts loans.ts
  notifications.ts   outgoing events to n8n, with retries
  automation.ts      overdue query, write-backs from n8n, admin automation page
  http.ts            the two endpoints n8n calls
src/                 Next.js app
n8n/workflows/       workflow exports
n8n/smtp-credential.mjs builds the SMTP credential from env at startup
tests/               convex-test tests
```

## Permissions

Checks are done in the Convex functions, the UI just hides buttons. Anything that needs an account starts with `requireUser` (or `requireAdmin`), which finds the user from the verified Clerk token. After that it's ownership: only the owner edits or deletes a listing, only the lender approves/declines/marks returned, only the borrower cancels. The public tool list is the only thing that works without an account.

Admins are the people in the `ADMIN_EMAILS` env var on Convex, with a verified email. `requireAdmin` checks that against the token on every call, so removing an address takes effect immediately. The client can't pass a role anywhere.

Booking rules:
- start date today or later, 30 days max
- can't overlap an approved loan; a loan that's late and not returned yet counts as running until it's returned
- approving a request declines the other pending requests for those dates
- once a pending request's dates have passed it can only be declined

You can't delete a tool while it's lent out or booked. An admin can remove any listing: pending requests and bookings that haven't started get cancelled (and those people notified), but a loan that's already out stays, because the borrower still has the tool. Loans store the tool name, so they still read fine after that.

## n8n

Three workflows in `n8n/workflows/`:

**Request notification.** Convex POSTs to it when a request is created, approved, declined, cancelled or returned, or when a listing with pending requests or bookings is removed. It checks the signature (401 if wrong), emails whoever should hear about it, then replies 200 to Convex and posts the result back. It only replies after sending, so if sending fails Convex gets an error and tries again later.

**Overdue reminders.** Every day at 09:00 (plus a manual trigger for testing). Gets the overdue loans from Convex (200 per run), emails each borrower and posts each result back. If sending to one person fails, that one is posted back as failed and the rest carry on; failed ones come back the next time it runs. If a write-back itself fails, the others still go through and the run is marked failed at the end.

**Error handler.** Error workflow for the other two. Posts "workflow / node: message" to Convex, which shows it on the admin page.

Both send real email through n8n's Send Email node, using an SMTP credential called "LendLoop SMTP". The credential is created from the `SMTP_*` values in `n8n/.env` when the containers start, so the password is only in `.env` and in n8n's encrypted credential store, never in the workflow files. Locally the emails go to Mailpit (inbox at http://localhost:8025); point the `SMTP_*` values at a real server to send them for real. Someone without an email address on their account gets "no email on file" recorded instead of a send.

### Signing

Both directions use an HMAC-SHA256 of `"<timestamp>.<raw body>"` in `X-LendLoop-Signature`, with the timestamp in `X-LendLoop-Timestamp`. Wrong signature or a timestamp more than 5 minutes off gets rejected. Each direction has its own secret (`CONVEX_TO_N8N_SECRET`, `N8N_TO_CONVEX_SECRET`).

Secrets are only in env vars: the Convex deployment's env, and `n8n/.env`, which the workflows read through `$env`. There are no keys in the workflow files.

What gets sent around is kept small: event, tool name, dates, and the recipient's first name and email. Users only see each other's first names. Emails are visible to admins only. The error handler sends the error message, not the data the workflow was working on.

### Retries and duplicates

- A loan change and its outgoing event are saved in the same mutation, so there's no event without the change or the other way round.
- Convex retries a failed delivery after 30s, 2m, 8m and 32m, then marks it failed (admin can retry). 400/401/403/422 aren't retried since they mean the request itself is wrong. The n8n HTTP nodes also retry (5 tries, 5s apart).
- Each write-back has a key (`loan:<id>:<event>` or `overdue:<loanId>:<date>`). Posting the same one again changes nothing, and the key has to match the loan it's for.
- The overdue endpoint skips loans that already got today's reminder, so a second run doesn't remind anyone twice.

One known gap: if n8n sends the message but its reply never reaches Convex, Convex retries and the person gets the message twice. Fixing that needs n8n to remember which event keys it already handled (e.g. in Postgres).

## Running it

Needs Node 20+, a Clerk account (free) and Docker for n8n. Convex can run locally without an account.

```bash
npm install
cp .env.example .env.local
npx convex dev
```

`convex dev` asks whether to run locally or log in, then writes the Convex URL to `.env.local`. The first push fails with "CLERK_JWT_ISSUER_DOMAIN ... not set", that's expected: set the env vars below and it redeploys on its own.

**Clerk.** Create an application and copy its keys into `.env.local` (see `.env.example`). Then add a JWT template called `convex` with these claims (activating Integrations > Convex creates the template too, but you still need the email claims):

```json
{
  "aud": "convex",
  "name": "{{user.full_name}}",
  "email": "{{user.primary_email_address}}",
  "email_verified": "{{user.email_verified}}"
}
```

**Convex env.**

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
npx convex env set ADMIN_EMAILS you@example.com
npx convex env set N8N_REQUEST_WEBHOOK_URL http://localhost:5678/webhook/lendloop-request
npx convex env set CONVEX_TO_N8N_SECRET <secret>
npx convex env set N8N_TO_CONVEX_SECRET <another secret>
```

`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` makes a decent secret.

**n8n.**

```bash
cp n8n/.env.example n8n/.env
docker compose up
```

Put the same two secrets and the Convex HTTP URL in `n8n/.env`; the SMTP defaults already point at the Mailpit container. The first `docker compose up` imports the three workflows and publishes them. Later starts skip that so edits made in the editor stick; remove the `n8n_data` volume to import again. The error workflow has to be published as well, otherwise n8n 2.x never runs it. If Convex runs in the cloud, n8n needs a public URL (a tunnel is fine) so Convex can reach the webhook.

**App.**

```bash
npm run dev
```

To try borrowing with a single account, sign in, list a tool, then run `npx convex run seed:demo`. That adds a neighbor (Sam) with two tools, a request from Sam for your tool, and an overdue loan of Sam's ladder to you.

### Tests

```bash
npm test
```

`convex-test` tests for:
- permissions: owner and admin rules, roles, unverified emails, removing admins
- the public list only returning name and category
- booking rules, including late loans
- what goes into the webhook payload
- signature checks: tampering, wrong secret, old timestamp
- the overdue reminder round trip and repeated write-backs
- delivery retries

## Env vars

| Where | Variable | |
|---|---|---|
| `.env.local` | `NEXT_PUBLIC_CONVEX_URL` | written by `convex dev` |
| `.env.local` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk keys |
| Convex | `CLERK_JWT_ISSUER_DOMAIN` | Clerk Frontend API URL |
| Convex | `ADMIN_EMAILS` | comma-separated |
| Convex | `N8N_REQUEST_WEBHOOK_URL` | n8n webhook URL |
| Convex, n8n | `CONVEX_TO_N8N_SECRET` | signs requests to n8n |
| Convex, n8n | `N8N_TO_CONVEX_SECRET` | signs requests to Convex |
| n8n | `CONVEX_SITE_URL` | Convex HTTP actions URL |
| n8n | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | outgoing mail, turned into the "LendLoop SMTP" credential |
| n8n | `MAIL_FROM` | sender address |
| n8n | `GENERIC_TIMEZONE`, `TZ` | timezone for the 09:00 run |

## What I'd change for production

The n8n-side dedupe mentioned above. Dates are UTC calendar days at the moment, so "overdue" flips at midnight UTC; a timezone per neighborhood would fix that. The list queries use fixed `take()` limits and would need pagination with more data. I'd also want rate limits on requests.

Hosting: the app on Vercel (or Amplify) and Convex Cloud. n8n self-hosted on AWS, roughly:

- ECS Fargate running n8n in queue mode (main + workers), RDS Postgres instead of SQLite, ElastiCache Redis for the queue
- an ALB with HTTPS (ACM certificate), only the webhook path public, the editor behind SSO or a VPN
- the two HMAC secrets in Secrets Manager, injected into the task definition rather than an `.env` file, and rotated with two secrets accepted for a short overlap
- SES as the SMTP server (just different `SMTP_*` values)
- CloudWatch alarms on failed n8n executions and on the Convex deliveries that end up `failed`, instead of only the admin page
