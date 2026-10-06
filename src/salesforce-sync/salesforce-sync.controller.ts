import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiConflictResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ADMIN_ROLE } from "../auth/constants";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { SalesforceSyncService } from "./salesforce-sync.service";

/** Administrator-only entry point for the Sales workspace's Salesforce metadata sync. */
@ApiTags("Billing Accounts")
@ApiBearerAuth("JWT")
@Controller("billing-accounts/salesforce-sync")
export class SalesforceSyncController {
  constructor(private readonly service: SalesforceSyncService) {}

  /**
   * Runs the complete metadata sync using the authenticated administrator's request.
   * @returns Per-model scanned, updated, unchanged, unmatched and conflicted counts.
   * @throws 403 without the administrator role; 409 for an active sync; 502/503 for Salesforce failures.
   */
  @Post()
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(ADMIN_ROLE)
  @ApiOperation({
    summary: "Sync client and billing-account metadata from Salesforce",
    description:
      "Requires an administrator user JWT. Scopes alone do not grant access. Updates all matching existing records, including opportunity IDs and inactive accounts; returns only after commit. Unmatched and conflicting identities are skipped and counted.",
  })
  @ApiOkResponse({
    description:
      "Sync committed; per-model scanned, updated, unchanged, unmatched and conflicted counts returned.",
  })
  @ApiForbiddenResponse({
    description:
      "An administrator role is required; M2M scopes do not grant access.",
  })
  @ApiConflictResponse({ description: "A sync is already running." })
  sync() {
    return this.service.sync();
  }
}
