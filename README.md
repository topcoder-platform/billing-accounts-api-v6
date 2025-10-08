# Topcoder Billing Accounts & Clients API (NestJS + Prisma)

**Project structure:**
- NestJS project
- Prisma schema for Clients, Billing Accounts, Locked & Consumed amounts
  - BillingAccount `id` is a Postgres `INT` auto-increment sequence (numeric, increasing)
- Endpoints:
  - `GET /billing-accounts` 
  - `POST /billing-accounts` 
  - `GET /billing-accounts/:billingAccountId` (includes locked/consumed arrays + budget totals)
  - `PATCH /billing-accounts/:billingAccountId`
  - `PATCH /billing-accounts/:billingAccountId/lock-amount` (0 amount = unlock)
  - `PATCH /billing-accounts/:billingAccountId/consume-amount` (deletes locks for challenge, then upserts consumed)
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
