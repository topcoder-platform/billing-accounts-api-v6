"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const prisma = new client_1.PrismaClient();
function toBool(v) {
    if (v === undefined || v === null || v === '')
        return undefined;
    if (typeof v === 'boolean')
        return v;
    if (typeof v === 'number')
        return v !== 0;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}
function toActiveInactive(v) {
    const b = toBool(v);
    return b ? 'ACTIVE' : 'INACTIVE';
}
function toDateOrNull(s) {
    if (!s)
        return null;
    const d = new Date(s.replace(' ', 'T') + (s.includes('T') ? '' : 'Z'));
    return isNaN(d.getTime()) ? null : d;
}
function toDecimalOrZero(s) {
    if (s === undefined || s === null || s === '')
        return new client_1.Prisma.Decimal(0);
    return new client_1.Prisma.Decimal(String(s));
}
function nonEmpty(s) {
    if (!s)
        return null;
    const t = String(s).trim();
    return t === '' ? null : t;
}
async function ensureDefaultClient(defaultClientId) {
    await prisma.client.upsert({
        where: { id: defaultClientId },
        create: {
            id: defaultClientId,
            name: 'Unknown Client (legacy)',
            codeName: 'legacy-unknown',
            status: 'ACTIVE',
        },
        update: {},
    });
}
async function importClients(items) {
    console.log(`Importing ${items.length} client(s)…`);
    let created = 0, updated = 0, skipped = 0;
    for (const c of items) {
        try {
            const id = String(c.client_id);
            await prisma.client.upsert({
                where: { id },
                create: {
                    id,
                    name: c.name,
                    codeName: nonEmpty(c.code_name) ?? nonEmpty(c.customer_number),
                    status: c.status === '1' ? 'ACTIVE' : 'INACTIVE',
                    startDate: toDateOrNull(c.start_date) ?? undefined,
                    endDate: toDateOrNull(c.end_date) ?? undefined,
                },
                update: {
                    name: c.name,
                    codeName: nonEmpty(c.code_name) ?? nonEmpty(c.customer_number) ?? undefined,
                    status: c.status === '1' ? 'ACTIVE' : 'INACTIVE',
                    startDate: toDateOrNull(c.start_date) ?? undefined,
                    endDate: toDateOrNull(c.end_date) ?? undefined,
                },
            });
            created++;
        }
        catch (e) {
            skipped++;
            console.error(`Client ${c.client_id} failed:`, e.message);
        }
    }
    console.log(`Clients imported. created/updated≈${created}, skipped=${skipped}`);
}
async function importProjects(items, defaultClientId) {
    console.log(`Importing ${items.length} billing account(s)…`);
    let ok = 0, skipped = 0;
    for (const p of items) {
        try {
            const id = String(p.project_id);
            let clientId = p.client_id != null ? String(p.client_id) : defaultClientId;
            const client = await prisma.client.findUnique({ where: { id: clientId } });
            if (!client) {
                clientId = defaultClientId;
            }
            await prisma.billingAccount.upsert({
                where: { id },
                create: {
                    id,
                    name: p.name,
                    description: nonEmpty(p.description),
                    status: toActiveInactive(p.active),
                    startDate: toDateOrNull(p.start_date) ?? undefined,
                    endDate: toDateOrNull(p.end_date) ?? undefined,
                    budget: toDecimalOrZero(p.budget),
                    markup: new client_1.Prisma.Decimal(0),
                    clientId,
                    poNumber: nonEmpty(p.po_box_number) ?? undefined,
                    subscriptionNumber: nonEmpty(p.subscription_number) ?? undefined,
                    isManualPrize: !!toBool(p.is_manual_prize_setting),
                    paymentTerms: nonEmpty(p.payment_terms_id) ?? undefined,
                    salesTax: p.sales_tax != null ? toDecimalOrZero(p.sales_tax) : undefined,
                    billable: toBool(p.billable) ?? true,
                    createdBy: nonEmpty(p.creation_user) ?? undefined,
                },
                update: {
                    name: p.name,
                    description: nonEmpty(p.description) ?? undefined,
                    status: toActiveInactive(p.active),
                    startDate: toDateOrNull(p.start_date) ?? undefined,
                    endDate: toDateOrNull(p.end_date) ?? undefined,
                    budget: toDecimalOrZero(p.budget),
                    clientId,
                    poNumber: nonEmpty(p.po_box_number) ?? undefined,
                    subscriptionNumber: nonEmpty(p.subscription_number) ?? undefined,
                    isManualPrize: !!toBool(p.is_manual_prize_setting),
                    paymentTerms: nonEmpty(p.payment_terms_id) ?? undefined,
                    salesTax: p.sales_tax != null ? toDecimalOrZero(p.sales_tax) : undefined,
                    billable: toBool(p.billable) ?? true,
                },
            });
            ok++;
        }
        catch (e) {
            skipped++;
            console.error(`Project ${p.project_id} failed:`, e.message);
        }
    }
    console.log(`Billing accounts imported. ok=${ok}, skipped=${skipped}`);
}
async function importChallengeBudgets(items) {
    console.log(`Importing ${items.length} project_challenge_budget row(s)…`);
    let locks = 0, consumes = 0, skipped = 0;
    for (const r of items) {
        const billingAccountId = String(r.project_id);
        const challengeId = String(r.challenge_id);
        const locked = toDecimalOrZero(r.locked_amount);
        const consumed = toDecimalOrZero(r.consumed_amount);
        try {
            const ba = await prisma.billingAccount.findUnique({ where: { id: billingAccountId } });
            if (!ba) {
                skipped++;
                console.warn(`Skipping challenge ${challengeId}: BA ${billingAccountId} not found`);
                continue;
            }
            if (consumed.greaterThan(0)) {
                await prisma.$transaction([
                    prisma.lockedAmount.deleteMany({ where: { billingAccountId, challengeId } }),
                    prisma.consumedAmount.upsert({
                        where: { consumed_unique_challenge: { billingAccountId, challengeId } },
                        create: { billingAccountId, challengeId, amount: consumed },
                        update: { amount: consumed },
                    }),
                ]);
                consumes++;
                continue;
            }
            if (locked.greaterThan(0)) {
                await prisma.lockedAmount.upsert({
                    where: { locked_unique_challenge: { billingAccountId, challengeId } },
                    create: { billingAccountId, challengeId, amount: locked },
                    update: { amount: locked },
                });
                locks++;
                continue;
            }
            await prisma.$transaction([
                prisma.lockedAmount.deleteMany({ where: { billingAccountId, challengeId } }),
                prisma.consumedAmount.deleteMany({ where: { billingAccountId, challengeId } }),
            ]);
        }
        catch (e) {
            skipped++;
            console.error(`ChallengeBudget ${billingAccountId}/${challengeId} failed:`, e.message);
        }
    }
    console.log(`Challenge budgets imported. locks=${locks}, consumed=${consumes}, skipped=${skipped}`);
}
function readJsonFromArgs() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: npm run import:legacy -- <file1.json> [file2.json ...] [--defaultClientId=<id>]');
        process.exit(1);
    }
    let defaultClientId = 'legacy-unknown-client';
    const files = [];
    for (const a of args) {
        if (a.startsWith('--defaultClientId='))
            defaultClientId = a.split('=')[1];
        else
            files.push(a);
    }
    const combined = {};
    for (const f of files) {
        const abs = path.resolve(process.cwd(), f);
        const raw = fs.readFileSync(abs, 'utf8');
        const data = JSON.parse(raw);
        for (const k of Object.keys(data)) {
            if (!combined[k])
                combined[k] = [];
            combined[k] = combined[k].concat(data[k] || []);
        }
    }
    combined.__defaultClientId = defaultClientId;
    return combined;
}
async function main() {
    const bundle = readJsonFromArgs();
    const defaultClientId = bundle.__defaultClientId || 'legacy-unknown-client';
    delete bundle.__defaultClientId;
    const clients = (bundle['time_oltp:client'] ?? []);
    const projects = (bundle['time_oltp:project'] ?? []);
    const budgets = (bundle['time_oltp:project_challenge_budget'] ?? []);
    console.log(`Importing ${clients.length} clients and ${projects.length} billing accounts`);
    await ensureDefaultClient(defaultClientId);
    if (clients.length)
        await importClients(clients);
    if (projects.length)
        await importProjects(projects, defaultClientId);
    if (budgets.length)
        await importChallengeBudgets(budgets);
    console.log('Import complete.');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=import-legacy.js.map