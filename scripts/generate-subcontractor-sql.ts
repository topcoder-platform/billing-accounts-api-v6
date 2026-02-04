/* eslint-disable no-console */
import "dotenv/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEFAULT_CSV_PATH = path.join(os.homedir(), "Downloads", "subcontractor.csv");
const BILLING_ACCOUNT_ID_COLUMN = "TopCoder_Billing_Account_Id__c";
const END_CUSTOMER_COLUMN = "Opportunity__r.Subcontracting_End_Customer__r.Name";

type CsvRow = {
  billingAccountId: number;
  endCustomer: string;
};

type ParsedArgs = {
  inputPath: string;
  schema: string;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let inputPath = DEFAULT_CSV_PATH;
  let schema: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--schema" || arg === "-s") {
      schema = args[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith("--schema=")) {
      schema = arg.split("=", 2)[1];
      continue;
    }
    inputPath = arg;
  }

  return {
    inputPath: resolvePath(inputPath),
    schema: schema?.trim() || parseSchemaFromDatabaseUrl(process.env.DATABASE_URL) || "billing-accounts",
  };
}

function resolvePath(p: string): string {
  if (p.startsWith("~")) {
    const remainder = p.startsWith(`~${path.sep}`) ? p.slice(2) : p.slice(1);
    return path.resolve(os.homedir(), remainder);
  }
  return path.resolve(process.cwd(), p);
}

function parseSchemaFromDatabaseUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const schema = parsed.searchParams.get("schema");
    return schema || undefined;
  } catch {
    return undefined;
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function loadCsvRows(filePath: string): CsvRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    throw new Error("CSV is empty.");
  }

  const header = parseCsvLine(lines[0]);
  const billingAccountIdIndex = header.indexOf(BILLING_ACCOUNT_ID_COLUMN);
  const endCustomerIndex = header.indexOf(END_CUSTOMER_COLUMN);

  if (billingAccountIdIndex === -1 || endCustomerIndex === -1) {
    throw new Error(
      `CSV header missing required columns (${BILLING_ACCOUNT_ID_COLUMN}, ${END_CUSTOMER_COLUMN}).`
    );
  }

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const idRaw = columns[billingAccountIdIndex];
    const endCustomerRaw = columns[endCustomerIndex];
    const billingAccountId = Number(idRaw);
    const endCustomer = (endCustomerRaw || "").trim();

    if (!Number.isFinite(billingAccountId)) {
      console.warn(`Skipping row with invalid billing account id: "${idRaw}"`);
      continue;
    }
    if (!endCustomer) {
      console.warn(`Skipping billing account ${billingAccountId}: missing end customer value.`);
      continue;
    }
    rows.push({ billingAccountId, endCustomer });
  }

  return rows;
}

function buildSql(rows: CsvRow[], schema: string): string[] {
  const tableRef = `${quoteIdentifier(schema)}.${quoteIdentifier("BillingAccount")}`;
  return rows.map(
    (row) =>
      `UPDATE ${tableRef} SET ${quoteIdentifier("subcontractingEndCustomer")} = ${quoteString(
        row.endCustomer
      )} WHERE ${quoteIdentifier("id")} = ${row.billingAccountId};`
  );
}

function main() {
  const { inputPath, schema } = parseArgs();
  const rows = loadCsvRows(inputPath);

  if (!rows.length) {
    console.warn("No valid data rows found in CSV. No SQL generated.");
    return;
  }

  const statements = buildSql(rows, schema);
  console.error(`Prepared ${statements.length} UPDATE statement(s) targeting schema "${schema}".`);
  console.log(statements.join("\n"));
}

main();
