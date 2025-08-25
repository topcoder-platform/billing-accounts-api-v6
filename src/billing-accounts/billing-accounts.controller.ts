import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
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

@Controller("billing-accounts")
export class BillingAccountsController {
  constructor(private readonly service: BillingAccountsService) {}

  @Get()
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE, COPILOT_ROLE)
  @Scopes(SCOPES.READ_BA, SCOPES.ALL_BA)
  async list(@Query() q: QueryBillingAccountsDto) {
    return this.service.list(q);
  }

  @Post()
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.CREATE_BA, SCOPES.ALL_BA)
  async create(@Body() dto: CreateBillingAccountDto) {
    return this.service.create(dto);
  }

  @Get(":billingAccountId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE, COPILOT_ROLE)
  @Scopes(SCOPES.READ_BA, SCOPES.ALL_BA)
  async get(@Param("billingAccountId") id: string) {
    return this.service.get(id);
  }

  @Patch(":billingAccountId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  async update(
    @Param("billingAccountId") id: string,
    @Body() dto: UpdateBillingAccountDto,
  ) {
    return this.service.update(id, dto);
  }

  @Patch(":billingAccountId/lock-amount")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  async lock(
    @Param("billingAccountId") id: string,
    @Body() dto: LockAmountDto,
  ) {
    return this.service.lockAmount(id, dto);
  }

  @Patch(":billingAccountId/consume-amount")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.UPDATE_BA, SCOPES.ALL_BA)
  async consume(
    @Param("billingAccountId") id: string,
    @Body() dto: ConsumeAmountDto,
  ) {
    return this.service.consumeAmount(id, dto);
  }
}
