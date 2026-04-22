import { Module } from "@nestjs/common";
import { BillingAccountsController } from "./billing-accounts.controller";
import { BillingAccountsService } from "./billing-accounts.service";
import { ExternalBudgetEntryLookupService } from "./external-budget-entry-lookup.service";
import { MembersLookupService } from "../common/members-lookup.service";
import SalesforceService from "../common/salesforce.service";

@Module({
  controllers: [BillingAccountsController],
  providers: [
    BillingAccountsService,
    ExternalBudgetEntryLookupService,
    MembersLookupService,
    SalesforceService,
  ],
  exports: [
    BillingAccountsService,
    ExternalBudgetEntryLookupService,
    MembersLookupService,
    SalesforceService,
  ],
})
export class BillingAccountsModule {}
