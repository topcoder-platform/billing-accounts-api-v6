/** Salesforce fields mirrored independently of legacy operational and financial fields. */
export const CLIENT_SALESFORCE_FIELDS = {
  salesforceAccountId: "Id",
  accountStatus: "Account_Status__c",
  billingStreet: "BillingStreet",
  billingCity: "BillingCity",
  billingState: "BillingState",
  billingPostalCode: "BillingPostalCode",
  billingCountry: "BillingCountry",
  phone: "Phone",
  website: "Website",
  industry: "Industry",
  parentId: "ParentId",
  paymentTerms: "Payment_Terms__c",
} as const;

/** Billing-account metadata; references retain Salesforce IDs, not local foreign keys. */
export const BILLING_ACCOUNT_SALESFORCE_FIELDS = {
  salesforceBillingAccountId: "Id",
  billingAccountType: "Billing_Account_Type__c",
  billingNotes: "Billing_Notes__c",
  billingFrequency: "Billing_Frequency__c",
  opportunity: "Opportunity__c",
  subscription: "Subscription__c",
  spoc: "SPOC__c",
  secondarySpoc: "Secondary_SPOC__c",
  costCenter: "Cost_Center__c",
  workdayContractNumber: "Workday_Contract_Number__c",
} as const;

/**
 * Picks explicitly supplied metadata for create/update DTOs, preserving null clears.
 * @param input Validated DTO containing optional metadata.
 * @param fields Allowed local field names and their Salesforce source names.
 * @returns Only defined metadata fields; never operational or financial fields.
 * @throws No exceptions for validated DTO input.
 */
export function pickSalesforceMetadata<K extends string>(
  input: Partial<Record<NoInfer<K>, string | null>>,
  fields: Record<K, string>,
): Partial<Record<K, string | null>> {
  return Object.fromEntries(
    (Object.keys(fields) as K[])
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  ) as Partial<Record<K, string | null>>;
}
