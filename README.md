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
  - `GET /clients` (search by name/codeName/status/date range; sort & pagination)
  - `GET /clients/:clientId`
  - `PATCH /clients/:clientId`

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
