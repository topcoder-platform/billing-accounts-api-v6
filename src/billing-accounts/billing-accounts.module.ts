import { Module } from "@nestjs/common";
import { BillingAccountsController } from "./billing-accounts.controller";
import { BillingAccountsService } from "./billing-accounts.service";
import { MembersLookupService } from "../common/members-lookup.service";
import SalesforceService from "../common/salesforce.service";

@Module({
  controllers: [BillingAccountsController],
  providers: [BillingAccountsService, MembersLookupService, SalesforceService],
  exports: [BillingAccountsService, MembersLookupService, SalesforceService],
})
export class BillingAccountsModule {}
