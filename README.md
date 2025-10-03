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
