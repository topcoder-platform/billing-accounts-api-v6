import { Module } from "@nestjs/common";
import { SalesforceSyncClient } from "./salesforce-sync.client";
import { SalesforceSyncController } from "./salesforce-sync.controller";
import { SalesforceSyncService } from "./salesforce-sync.service";

/** Wires the administrator sync endpoint to the shared database and read-only Salesforce client. */
@Module({
  controllers: [SalesforceSyncController],
  providers: [SalesforceSyncClient, SalesforceSyncService],
})
export class SalesforceSyncModule {}
