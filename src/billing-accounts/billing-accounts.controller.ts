import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseIntPipe,
} from "@nestjs/common";
import { BillingAccountsService } from "./billing-accounts.service";
import { QueryBillingAccountsDto } from "./dto/query-billing-accounts.dto";
import { CreateBillingAccountDto } from "./dto/create-billing-account.dto";
import { UpdateBillingAccountDto } from "./dto/update-billing-account.dto";
import { LockAmountDto } from "./dto/lock-amount.dto";
import { ConsumeAmountDto } from "./dto/consume-amount.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { Scopes } from "../auth/decorators/scopes.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ScopesGuard } from "../auth/guards/scopes.guard";
import { SCOPES, ADMIN_ROLE, COPILOT_ROLE } from "../auth/constants";
import { buildOperationDoc } from "../common/swagger/swagger-auth.util";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBody,
} from "@nestjs/swagger";

@ApiTags("Billing Accounts")
@ApiBearerAuth("JWT")
@ApiBearerAuth("M2M")
@Controller("billing-accounts")
export class BillingAccountsController {
  constructor(private readonly service: BillingAccountsService) {}

  @Get()
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE, COPILOT_ROLE)
  @Scopes(SCOPES.READ_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "List billing accounts",
      description: "Retrieve billing accounts with optional filters, sorting, and pagination.",
      jwtRoles: [ADMIN_ROLE, COPILOT_ROLE],
      m2mScopes: [SCOPES.READ_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Paginated list of billing accounts returned" })
  @ApiQuery({ name: "clientId", required: false })
  @ApiQuery({ name: "userId", required: false })
  @ApiQuery({ name: "status", required: false, enum: ["ACTIVE", "INACTIVE"] })
  @ApiQuery({ name: "sortBy", required: false, enum: ["endDate", "id", "createdAt", "createdBy", "remainingBudget"] })
  @ApiQuery({ name: "sortOrder", required: false, enum: ["asc", "desc"] })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "perPage", required: false, type: Number })
  async list(@Query() q: QueryBillingAccountsDto) {
    return this.service.list(q);
  }

  @Post()
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.CREATE_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Create a billing account",
      description: "Create a new billing account with the provided project and budget details.",
      jwtRoles: [ADMIN_ROLE],
      m2mScopes: [SCOPES.CREATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Billing account created" })
  @ApiBody({ type: CreateBillingAccountDto })
  async create(@Body() dto: CreateBillingAccountDto) {
    return this.service.create(dto);
  }

  @Get(":billingAccountId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE, COPILOT_ROLE)
  @Scopes(SCOPES.READ_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Get a billing account",
      description: "Fetch a billing account by its identifier, including budget and client data.",
      jwtRoles: [ADMIN_ROLE, COPILOT_ROLE],
      m2mScopes: [SCOPES.READ_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Billing account returned" })
  @ApiParam({ name: "billingAccountId", description: "Billing Account ID", type: Number })
  async get(@Param("billingAccountId", ParseIntPipe) id: number) {
    return this.service.get(id);
  }

  @Patch(":billingAccountId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Update a billing account",
      description: "Update billing account metadata or budget details.",
      jwtRoles: [ADMIN_ROLE],
      m2mScopes: [SCOPES.UPDATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Billing account updated" })
  @ApiParam({ name: "billingAccountId", description: "Billing Account ID", type: Number })
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
      summary: "Lock funds for a challenge",
      description: "Reserve an amount on a billing account for a specific challenge.",
      jwtRoles: [ADMIN_ROLE],
      m2mScopes: [SCOPES.UPDATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Lock created/updated or unlocked" })
  @ApiParam({ name: "billingAccountId", description: "Billing Account ID", type: Number })
  @ApiBody({ type: LockAmountDto })
  async lock(
    @Param("billingAccountId", ParseIntPipe) id: number,
    @Body() dto: LockAmountDto,
  ) {
    return this.service.lockAmount(id, dto);
  }

  @Patch(":billingAccountId/consume-amount")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  @ApiOperation(
    buildOperationDoc({
      summary: "Consume reserved funds",
      description: "Consume a previously locked amount for a challenge and record the transaction.",
      jwtRoles: [ADMIN_ROLE],
      m2mScopes: [SCOPES.UPDATE_BA, SCOPES.ALL_BA],
    }),
  )
  @ApiOkResponse({ description: "Consumed amount recorded" })
  @ApiParam({ name: "billingAccountId", description: "Billing Account ID", type: Number })
  @ApiBody({ type: ConsumeAmountDto })
  async consume(
    @Param("billingAccountId", ParseIntPipe) id: number,
    @Body() dto: ConsumeAmountDto,
  ) {
    return this.service.consumeAmount(id, dto);
  }
}
