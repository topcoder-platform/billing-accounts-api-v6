import {
  Body,
  Controller,
  Req,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseIntPipe,
  Delete,
} from "@nestjs/common";
import { BillingAccountsService } from "./billing-accounts.service";
import type { BillingAccountsAuthUser } from "./billing-accounts.service";
import { QueryBillingAccountsDto } from "./dto/query-billing-accounts.dto";
import { CreateBillingAccountDto } from "./dto/create-billing-account.dto";
import { UpdateBillingAccountDto } from "./dto/update-billing-account.dto";
import { LockAmountDto } from "./dto/lock-amount.dto";
import { ConsumeAmountDto } from "./dto/consume-amount.dto";
import { ConsumeAmountsDto } from "./dto/consume-amounts.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { Scopes } from "../auth/decorators/scopes.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ScopesGuard } from "../auth/guards/scopes.guard";
import {
  SCOPES,
  ADMIN_ROLE,
  COPILOT_ROLE,
  PROJECT_MANAGER_ROLE,
  TALENT_MANAGER_ROLE,
  TOPCODER_PROJECT_MANAGER_ROLE,
  TOPCODER_TALENT_MANAGER_ROLE,
} from "../auth/constants";
import type { Request } from "express";
import { buildOperationDoc } from "../common/swagger/swagger-auth.util";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBody,
} from "@nestjs/swagger";

const BILLING_ACCOUNT_READ_ROLES = [
  ADMIN_ROLE,
  COPILOT_ROLE,
  TALENT_MANAGER_ROLE,
  TOPCODER_TALENT_MANAGER_ROLE,
];

const BILLING_ACCOUNT_PROJECT_READ_ROLES = [
  ...BILLING_ACCOUNT_READ_ROLES,
  PROJECT_MANAGER_ROLE,
  TOPCODER_PROJECT_MANAGER_ROLE,
];

const BILLING_ACCOUNT_MANAGE_ROLES = [
  ADMIN_ROLE,
  TALENT_MANAGER_ROLE,
  TOPCODER_TALENT_MANAGER_ROLE,
];

interface BillingAccountsRequest extends Request {
  authUser?: BillingAccountsAuthUser;
}

@ApiTags("Billing Accounts")
@ApiBearerAuth("JWT")
@ApiBearerAuth("M2M")
@Controller("billing-accounts")
export class BillingAccountsController {
  constructor(private readonly service: BillingAccountsService) {}

  @Get()
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(...BILLING_ACCOUNT_PROJECT_READ_ROLES)
  @Scopes(SCOPES.READ_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "List billing accounts",
      description:
        "Retrieve billing accounts with optional filters, sorting, and pagination. Project Managers are limited to billing accounts granted to their own user id.",
      jwtRoles: BILLING_ACCOUNT_PROJECT_READ_ROLES,
      m2mScopes: [SCOPES.READ_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Paginated list of billing accounts returned" })
  @ApiQuery({
    name: "name",
    required: false,
    description: "Filter by name (contains, case-insensitive)",
  })
  @ApiQuery({ name: "clientId", required: false })
  @ApiQuery({ name: "userId", required: false })
  @ApiQuery({ name: "status", required: false, enum: ["ACTIVE", "INACTIVE"] })
  @ApiQuery({ name: "startDateFrom", required: false, type: String })
  @ApiQuery({ name: "startDateTo", required: false, type: String })
  @ApiQuery({ name: "endDateFrom", required: false, type: String })
  @ApiQuery({ name: "endDateTo", required: false, type: String })
  @ApiQuery({
    name: "sortBy",
    required: false,
    enum: [
      "endDate",
      "startDate",
      "id",
      "createdAt",
      "createdBy",
      "remainingBudget",
    ],
  })
  @ApiQuery({ name: "sortOrder", required: false, enum: ["asc", "desc"] })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "perPage", required: false, type: Number })
  async list(
    @Query() q: QueryBillingAccountsDto,
    @Req() req: BillingAccountsRequest,
  ) {
    return this.service.list(q, req.authUser);
  }

  @Post()
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(...BILLING_ACCOUNT_MANAGE_ROLES)
  @Scopes(SCOPES.CREATE_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Create a billing account",
      description:
        "Create a new billing account with the provided project and budget details.",
      jwtRoles: BILLING_ACCOUNT_MANAGE_ROLES,
      m2mScopes: [SCOPES.CREATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Billing account created" })
  @ApiBody({ type: CreateBillingAccountDto })
  async create(@Body() dto: CreateBillingAccountDto) {
    return this.service.create(dto);
  }

  @Get("users/:userId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE, COPILOT_ROLE)
  @Scopes(SCOPES.READ_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "List billing accounts accessible by user",
      description:
        "Retrieve billing accounts that the given user ID has access to (via Salesforce).",
      jwtRoles: [ADMIN_ROLE, COPILOT_ROLE],
      m2mScopes: [SCOPES.READ_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "List of billing accounts returned" })
  @ApiParam({
    name: "userId",
    description: "User ID (number)",
    type: Number,
  })
  async listByUserIds(@Param("userId", ParseIntPipe) userId: number) {
    return this.service.listByUserId(userId);
  }

  @Get(":billingAccountId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(...BILLING_ACCOUNT_PROJECT_READ_ROLES)
  @Scopes(SCOPES.READ_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Get a billing account",
      description:
        "Fetch a billing account by its identifier, including budget, client data, and normalized locked/consumed line items. Line items include amount, date, externalId, externalType, externalName, and challengeId only for legacy challenge compatibility. Project Managers can read only billing accounts granted to them.",
      jwtRoles: BILLING_ACCOUNT_PROJECT_READ_ROLES,
      m2mScopes: [SCOPES.READ_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Billing account returned" })
  @ApiParam({
    name: "billingAccountId",
    description: "Billing Account ID",
    type: Number,
  })
  async get(
    @Param("billingAccountId", ParseIntPipe) id: number,
    @Req() req: BillingAccountsRequest,
  ) {
    return this.service.get(id, req.authUser);
  }

  @Patch(":billingAccountId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(...BILLING_ACCOUNT_MANAGE_ROLES)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Update a billing account",
      description: "Update billing account metadata or budget details.",
      jwtRoles: BILLING_ACCOUNT_MANAGE_ROLES,
      m2mScopes: [SCOPES.UPDATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Billing account updated" })
  @ApiParam({
    name: "billingAccountId",
    description: "Billing Account ID",
    type: Number,
  })
  @ApiBody({ type: UpdateBillingAccountDto })
  async update(
    @Param("billingAccountId", ParseIntPipe) id: number,
    @Body() dto: UpdateBillingAccountDto,
  ) {
    return this.service.update(id, dto);
  }

  @Patch(":billingAccountId/lock-amount")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Lock funds for a typed external budget entry",
      description:
        "Reserve a non-negative amount on a billing account for a challenge reference. Locking supports CHALLENGE externalType only, accepts externalId/externalType as the canonical reference fields, treats amount 0 as unlock, and fails when the post-lock reserved total would exceed the account budget.",
      jwtRoles: [ADMIN_ROLE],
      m2mScopes: [SCOPES.UPDATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Lock created/updated or unlocked" })
  @ApiBadRequestResponse({
    description:
      "Invalid typed external reference, negative amount, challenge already consumed, or insufficient remaining funds",
  })
  @ApiParam({
    name: "billingAccountId",
    description: "Billing Account ID",
    type: Number,
  })
  @ApiBody({ type: LockAmountDto })
  async lock(
    @Param("billingAccountId", ParseIntPipe) id: number,
    @Body() dto: LockAmountDto,
  ) {
    return this.service.lockAmount(id, dto);
  }

  @Post("consume-amounts")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Atomically consume engagement budget rows",
      description:
        "Validate and create one or more ENGAGEMENT consumed rows in a single transaction. The request fails without writing partial rows when any item is invalid or would exceed remaining budget.",
      jwtRoles: [ADMIN_ROLE],
      m2mScopes: [SCOPES.UPDATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Engagement consumed rows recorded" })
  @ApiBadRequestResponse({
    description:
      "Invalid engagement reference, non-positive amount, or insufficient remaining funds",
  })
  @ApiBody({ type: ConsumeAmountsDto })
  async consumeBatch(@Body() dto: ConsumeAmountsDto) {
    return this.service.consumeAmounts(dto);
  }

  @Patch(":billingAccountId/consume-amount")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Consume funds for a typed external budget entry",
      description:
        "Consume a positive amount for a typed external reference using externalId/externalType. Challenge entries remove the matching lock and overwrite the existing consumed row; engagement entries are append-only. The request fails when the post-consume reserved total would exceed the account budget.",
      jwtRoles: [ADMIN_ROLE],
      m2mScopes: [SCOPES.UPDATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Consumed amount recorded" })
  @ApiBadRequestResponse({
    description:
      "Invalid typed external reference, non-positive amount, or insufficient remaining funds",
  })
  @ApiParam({
    name: "billingAccountId",
    description: "Billing Account ID",
    type: Number,
  })
  @ApiBody({ type: ConsumeAmountDto })
  async consume(
    @Param("billingAccountId", ParseIntPipe) id: number,
    @Body() dto: ConsumeAmountDto,
  ) {
    return this.service.consumeAmount(id, dto);
  }

  // --- Resources (Users) management ---

  @Get(":billingAccountId/users")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(...BILLING_ACCOUNT_READ_ROLES)
  @Scopes(SCOPES.READ_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "List billing account resources",
      description:
        "List users assigned to a billing account (includes member handle).",
      jwtRoles: BILLING_ACCOUNT_READ_ROLES,
      m2mScopes: [SCOPES.READ_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "List of resources returned" })
  @ApiParam({
    name: "billingAccountId",
    description: "Billing Account ID",
    type: Number,
  })
  async listUsers(@Param("billingAccountId", ParseIntPipe) id: number) {
    return this.service.listUsers(id);
  }

  @Post(":billingAccountId/users")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(...BILLING_ACCOUNT_MANAGE_ROLES)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Add a user to billing account",
      description: "Grant resource access to a user on the billing account.",
      jwtRoles: BILLING_ACCOUNT_MANAGE_ROLES,
      m2mScopes: [SCOPES.UPDATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "User added" })
  @ApiParam({
    name: "billingAccountId",
    description: "Billing Account ID",
    type: Number,
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        param: {
          type: "object",
          properties: { userId: { type: "string" } },
          required: ["userId"],
        },
        userId: { type: "string" },
      },
      required: ["param"],
      example: {
        param: {
          userId: "12345678",
        },
      },
    },
  })
  async addUser(
    @Param("billingAccountId", ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    const userId: string | undefined = body?.param?.userId ?? body?.userId;
    if (!userId) throw new Error("userId is required");
    return this.service.addUser(id, String(userId));
  }

  @Delete(":billingAccountId/users/:userId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(...BILLING_ACCOUNT_MANAGE_ROLES)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Remove a user from billing account",
      description: "Revoke resource access for a user on this billing account.",
      jwtRoles: BILLING_ACCOUNT_MANAGE_ROLES,
      m2mScopes: [SCOPES.UPDATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "User removed" })
  @ApiParam({
    name: "billingAccountId",
    description: "Billing Account ID",
    type: Number,
  })
  @ApiParam({ name: "userId", description: "User ID (string)" })
  async removeUser(
    @Param("billingAccountId", ParseIntPipe) id: number,
    @Param("userId") userId: string,
  ) {
    return this.service.removeUser(id, userId);
  }

  @Get(":billingAccountId/users/:userId/access")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(...BILLING_ACCOUNT_READ_ROLES)
  @Scopes(SCOPES.READ_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Check user access",
      description:
        "Return whether a given user has access to the billing account.",
      jwtRoles: BILLING_ACCOUNT_READ_ROLES,
      m2mScopes: [SCOPES.READ_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Boolean access returned" })
  @ApiParam({
    name: "billingAccountId",
    description: "Billing Account ID",
    type: Number,
  })
  @ApiParam({ name: "userId", description: "User ID (string)" })
  async hasAccess(
    @Param("billingAccountId", ParseIntPipe) id: number,
    @Param("userId") userId: string,
  ) {
    return this.service.hasAccess(id, userId);
  }
}
