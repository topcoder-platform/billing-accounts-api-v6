# Topcoder Billing Accounts & Clients API (NestJS + Prisma, CommonJS)

**What you get:**
- NestJS project with CommonJS `tsconfig.json`
- Prisma schema for Clients, Billing Accounts, Locked & Consumed amounts
- Endpoints:
  - `GET /billing-accounts` (filter, sort, pagination, userId + clientId filters)
  - `POST /billing-accounts` (Admin role or M2M scopes)
  - `GET /billing-accounts/:billingAccountId` (includes locked/consumed arrays + budget totals)
  - `PATCH /billing-accounts/:billingAccountId`
  - `PATCH /billing-accounts/:billingAccountId/lock-amount` (0 amount = unlock)
  - `PATCH /billing-accounts/:billingAccountId/consume-amount` (deletes locks for challenge, then upserts consumed)
  - `GET /clients` (search by name/codeName/status/date range; sort & pagination)
  - `GET /clients/:clientId`
  - `PATCH /clients/:clientId`

**Auth**
- Express-style JWT middleware via `tc-core-library-js` attaches `req.authUser`
- Guards for Roles (e.g., `Administrator`) and Scopes (M2M) are provided.
- Configure env: `AUTH_SECRET` or `AUTH0_URL/AUDIENCE/ISSUER` as needed.

## Quickstart

```bash
cp .env.example .env
# edit .env and set DATABASE_URL, auth vars, etc.

npm i
npm run prisma:generate
npm run prisma:migrate

npm run dev
# or
npm run build && npm start
```

> If you need integer IDs for billing accounts/clients, switch `id` fields in `prisma/schema.prisma` to `BigInt` and adjust DTOs accordingly.
