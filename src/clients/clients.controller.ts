import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Body,
  UseGuards,
} from "@nestjs/common";
import { ClientsService } from "./clients.service";
import { QueryClientsDto } from "./dto/query-clients.dto";
import { UpdateClientDto } from "./dto/update-client.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { Scopes } from "../auth/decorators/scopes.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ScopesGuard } from "../auth/guards/scopes.guard";
import { SCOPES, ADMIN_ROLE } from "../auth/constants";

@Controller("clients")
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get()
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.READ_CLIENT, SCOPES.ALL_CLIENT)
  async list(@Query() q: QueryClientsDto) {
    return this.service.list(q);
  }

  @Get(":clientId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.READ_CLIENT, SCOPES.ALL_CLIENT)
  async get(@Param("clientId") id: string) {
    return this.service.get(id);
  }

  @Patch(":clientId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.UPDATE_CLIENT, SCOPES.ALL_CLIENT)
  async update(@Param("clientId") id: string, @Body() dto: UpdateClientDto) {
    return this.service.update(id, dto);
  }
}
