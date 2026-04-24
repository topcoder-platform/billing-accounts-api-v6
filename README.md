# Topcoder Billing Accounts & Clients API (NestJS + Prisma)

**Project structure:**
- NestJS project
- Prisma schema for Clients, Billing Accounts, Locked & Consumed amounts
  - BillingAccount `id` is a Postgres `INT` auto-increment sequence (numeric, increasing)
- Endpoints:
  - `GET /billing-accounts` 
  - `POST /billing-accounts` 
  - `GET /billing-accounts/:billingAccountId` (includes locked/consumed arrays + budget totals; line items expose `amount`, `date`, `externalId`, `externalType`, `externalName`, and `challengeId` only for challenge compatibility; copilot, Project Manager, and Talent Manager callers only receive line items for projects they belong to)
  - `GET /billing-accounts/users/:userId` (list billing accounts accessible by the given Topcoder user ID — resolved via Salesforce resource object)
  - `PATCH /billing-accounts/:billingAccountId`
  - `PATCH /billing-accounts/:billingAccountId/lock-amount` (challenge-only typed reference; non-negative amount; 0 amount = unlock; rejects insufficient remaining funds)
  - `PATCH /billing-accounts/:billingAccountId/consume-amount` (positive amount; challenge typed references delete the matching lock and overwrite consumed; engagement typed references append a consumed row; rejects insufficient remaining funds)
  - `GET /billing-accounts/:billingAccountId/users` (list users with access)
  - `POST /billing-accounts/:billingAccountId/users` (grant access; accepts `{ param: { userId } }` or `{ userId }`)
  - `DELETE /billing-accounts/:billingAccountId/users/:userId` (revoke access)
  - `GET /billing-accounts/:billingAccountId/users/:userId/access` (boolean access check)
  - `GET /clients` (search by name/codeName/status/date range; sort & pagination)
  - `GET /clients/:clientId`
  - `PATCH /clients/:clientId`
  - `POST /clients`

**Authorization**
- JWT middleware via `tc-core-library-js` attaches `req.authUser`
- Guards for Roles (e.g., `Administrator`) and M2M Scopes are provided.
- Billing-account management endpoints accept `administrator`, `Talent Manager`,
  and `Topcoder Talent Manager` JWT roles; read-only billing-account lookups
  also continue to allow `copilot`, `Project Manager`, and `Topcoder Project Manager`.
  Project Managers are restricted to billing accounts granted to their own
  user id on `GET /billing-accounts` and `GET /billing-accounts/:billingAccountId`.
  On billing-account detail responses, copilot, Project Manager, and Talent
  Manager callers only receive locked/consumed line items whose challenge or
  engagement project maps to an active `project_members` row for their user id.
  Line items with unresolved project access are omitted for those callers.
  Role checks are case-insensitive so mixed token casing does not block access.
- Configure env: `AUTH_SECRET` or `AUTH0_URL/AUDIENCE/ISSUER` as needed.

## Quickstart

```bash
cp .env.example .env
# edit .env and set DATABASE_URL, auth vars, etc.

pnpm i
pnpm run prisma:generate
pnpm run prisma:migrate

pnpm run dev
# or
pnpm run build && pnpm start
```

## Salesforce integration

- This service can resolve billing accounts a user has access to via Salesforce. To enable Salesforce calls, configure the following environment variables in `.env` (see `.env.example`):
  - `SALESFORCE_CLIENT_ID` — Connected App client ID
  - `SALESFORCE_SUBJECT` — integration user username (subject for JWT)
  - `SALESFORCE_CLIENT_KEY` — PEM private key for the connected app (escape newlines as `\\n` in single-line `.env` files)
  - `SALESFORCE_AUDIENCE` — login URL (default `https://login.salesforce.com`, use `https://test.salesforce.com` for sandbox)

- Optional overrides for field names returned by your Salesforce org are available via `SFDC_BILLING_ACCOUNT_NAME_FIELD`, `SFDC_BILLING_ACCOUNT_MARKUP_FIELD`, and `SFDC_BILLING_ACCOUNT_ACTIVE_FIELD`.

- Once configured, you can call `GET /v6/billing-accounts/users/:userId` to obtain billing accounts the specified user has access to (the service authenticates to Salesforce using JWT Bearer flow and queries resource objects).

## Import scripts

- Legacy import (clients, billing accounts, challenge budgets):
  - `pnpm run import:legacy -- <file1.json> [file2.json ...] [--defaultClientId=<id>]`

- BillingAccountAccess import (from time_oltp exports):
  - Requires `MEMBER_DB_URL` in `.env` pointing to the Members DB.
  - Usage:
    - `pnpm run import:access -- /mnt/export/billing_accounts/time_oltp:project_manager_1.json /mnt/export/billing_accounts/time_oltp:user_account_1.json`
  - The script will:
    - Read `time_oltp:project_manager` and `time_oltp:user_account` records
    - For each project manager row, map `project_id` to `BillingAccountAccess.billingAccountId`
    - Lookup the matching `user_account` by `user_account_id`, then query the Members DB by `user_name` (handle)
    - Upsert `BillingAccountAccess` for the resolved `userId`

- Engagement payment consumed backfill:
  - Required env:
    - `DATABASE_URL` for billing-accounts-api-v6.
    - `FINANCE_DB_URL` for tc-finance-api (`winnings` and `payment`).
    - `ENGAGEMENTS_DB_URL` for engagements-api-v6 (`EngagementAssignment` and `Engagement`).
    - `PROJECTS_DB_URL` for projects-api-v6 (`projects.billingAccountId`, matching the trusted project lookup used by engagements-api-v6).
    - Optional `TGBillingAccounts` for finance-compatible TopGear exemptions. If unset, the script uses finance's default exempt accounts `80000062,80002800`.
  - Dry run:
    - `pnpm run backfill:engagementPayments -- --dry-run`
    - Dry run is the default. It reads finance engagement payments, resolves assignment/project/billing account context, plans inserts/updates, and writes a JSON audit report under `scripts/output/`.
  - Apply:
    - `pnpm run backfill:engagementPayments -- --apply`
    - Optional filters: `--assignmentId=<id>[,<id>]`, `--winningId=<id>[,<id>]`, `--since=<iso-date>`, `--until=<iso-date>`, `--limit=<n>`, `--report=<path>`.
  - Behavior:
    - Uses `payment.challenge_markup` first as a markup rate and computes `total_amount + (total_amount * challenge_markup)`.
    - If `payment.challenge_markup` is absent and `payment.challenge_fee` is present, treats `challenge_fee` as an absolute fee amount, computes `total_amount + challenge_fee`, and records the row in the `absoluteFee` audit bucket.
    - If neither finance value is present, falls back to the current `BillingAccount.markup` and records that fallback in the audit report.
    - Skips automated consumed-row planning for TopGear-exempt billing accounts and records those payments in the `exemptBillingAccounts` audit bucket.
    - Apply mode runs billing mutations, post-apply total calculation, and report writing inside one billing database transaction. If a write, verification read, or report write fails before commit, the billing mutations are rolled back.
    - Reconciles one assignment-level aggregate row for historical idempotency. Existing correct rows are left alone; a single incorrect row is updated; multiple existing rows are only moved when their total already matches the legacy expected amount.
    - Exceptions such as missing assignments, missing project billing accounts, missing billing accounts, and ambiguous consumed duplicates are reported without blocking resolvable assignments.
  - Validation:
    - The dry-run/apply report includes expected legacy totals and current/projected billing totals.
    - `verify:engagementPayments` invokes `psql` directly, so export `DATABASE_URL` in the shell before running it.
    - If the source schemas are visible in one Postgres session, run:
      - `pnpm run verify:engagementPayments -- -v finance_schema=finance -v engagements_schema=public -v projects_schema=projects -v billing_schema=billing-accounts -v exempt_billing_account_ids=80000062,80002800`
    - The verification SQL lists mismatches between expected legacy engagement-payment consumes and `ConsumedAmount` rows with `externalType = ENGAGEMENT`. TopGear-exempt accounts are reported separately as `topgear_exempt_*` statuses.
  - Rollback:
    - Use the JSON report from the apply run. A successful apply only commits after that report is written. Delete rows listed with `action: "insert"` and `createdId`; restore rows listed with `action: "update_single"` from `previous`; restore rows listed with `action: "move_existing_rows"` from their `existingRows` billing account ids.
    - If apply mode exits with an error before writing the report, the transaction rolled back and there should be no partial billing-ledger changes from that run.
    - If apply mode exits with an error after a report file exists, run the verifier or a dry run before rollback; the billing transaction should have committed all planned actions or none.

## Downstream Usage

- This service is consumed (directly or indirectly) by multiple Topcoder apps. The pointers below help with debugging.

**platform-ui**

- Admin pages use v6 endpoints to manage Clients, Billing Accounts, and Billing Account resources (users):
  - Search billing accounts: `GET /v6/billing-accounts?{filters}&page&perPage&sortBy&sortOrder`.
  - Get billing account detail: `GET /v6/billing-accounts/{id}`.
  - Create billing account: `POST /v6/billing-accounts`.
  - Update billing account: `PATCH /v6/billing-accounts/{id}`.
  - List billing account users: `GET /v6/billing-accounts/{id}/users`.
  - Add billing account user: `POST /v6/billing-accounts/{id}/users` with `{ param: { userId } }`.
  - Remove billing account user: `DELETE /v6/billing-accounts/{id}/users/{userId}`.
  - Search clients: `GET /v6/clients?{filters}&page&perPage&sortBy&sortOrder`.
  - Get client detail: `GET /v6/clients/{id}`.
  - Create client: `POST /v6/clients`.
  - Update client: `PATCH /v6/clients/{id}`.
- Key references in the UI codebase:
  - `platform-ui/src/apps/admin/src/lib/services/billing-accounts.service.ts`
  - `platform-ui/src/apps/admin/src/lib/services/client.service.ts`
  - `platform-ui/src/apps/admin/src/lib/hooks/useManageBillingAccounts.ts`
  - `platform-ui/src/apps/admin/src/lib/hooks/useManageBillingAccountDetail.ts`
  - `platform-ui/src/apps/admin/src/lib/hooks/useManageBillingAccountResources.ts`
  - `platform-ui/src/apps/admin/src/lib/hooks/useManageAddBillingAccount.ts`
  - `platform-ui/src/apps/admin/src/lib/hooks/useManageAddBillingAccountResource.ts`
- Local dev proxy maps the Billing Accounts & Clients routes to this service:
  - See `platform-ui/src/config/environments/local.env.ts` for entries routing `/v6/billing-accounts` and `/v6/clients` (and `/v5/billing-accounts`) to `http://localhost:3010`.
  - Swagger is available at `http://localhost:<PORT>/v6/billing-accounts/api-docs` (default `<PORT>` is `3000` per `.env.example`). Adjust the proxy or service port as needed.

**community-app**

- Doesn't use

**work-manager**

- Work Manager does not call this API directly. It loads billing account options and selections through the Projects API, e.g.:
  - `GET {PROJECTS_API_URL}/{projectId}/billingAccounts`
  - `GET {PROJECTS_API_URL}/{projectId}/billingAccount`
- Key references in the Work Manager codebase:
  - `work-manager/src/services/projects.js`
  - UI wiring in containers/components under `work-manager/src/containers/Challenges` and `work-manager/src/components/`
- If/when Work Manager migrates to call this service directly, equivalent v6 endpoints include:
  - Search/list: `GET /v6/billing-accounts?{filters}` (supports `userId`, `clientId`, `status`, and date range filters)
  - Detail: `GET /v6/billing-accounts/{id}`
  - Access check: `GET /v6/billing-accounts/{id}/users/{userId}/access`
