import { Module } from "@nestjs/common";
import { BillingAccountsController } from "./billing-accounts.controller";
import { BillingAccountsService } from "./billing-accounts.service";
import { MembersLookupService } from "../common/members-lookup.service";

@Module({
  controllers: [BillingAccountsController],
  providers: [BillingAccountsService, MembersLookupService],
  exports: [BillingAccountsService, MembersLookupService],
})
export class BillingAccountsModule {}
