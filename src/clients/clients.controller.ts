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

@ApiTags("Clients")
@ApiBearerAuth("JWT")
@ApiBearerAuth("M2M")
@Controller("clients")
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get()
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.READ_CLIENT, SCOPES.ALL_CLIENT)
  @ApiOperation(
    buildOperationDoc({
      summary: "List clients",
      description: "Retrieve clients with optional filters, sorting, and pagination.",
      jwtRoles: [ADMIN_ROLE],
      m2mScopes: [SCOPES.READ_CLIENT, SCOPES.ALL_CLIENT],
    }),
  )
  @ApiOkResponse({ description: "Paginated list of clients returned" })
  @ApiQuery({ name: "name", required: false })
  @ApiQuery({ name: "codeName", required: false })
  @ApiQuery({ name: "status", required: false, enum: ["ACTIVE", "INACTIVE"] })
  @ApiQuery({ name: "startDateFrom", required: false, type: String })
  @ApiQuery({ name: "startDateTo", required: false, type: String })
  @ApiQuery({ name: "endDateFrom", required: false, type: String })
  @ApiQuery({ name: "endDateTo", required: false, type: String })
  @ApiQuery({ name: "sortBy", required: false, enum: ["name", "startDate", "endDate", "status", "createdAt"] })
  @ApiQuery({ name: "sortOrder", required: false, enum: ["asc", "desc"] })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "perPage", required: false, type: Number })
  async list(@Query() q: QueryClientsDto) {
    return this.service.list(q);
  }

  @Get(":clientId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.READ_CLIENT, SCOPES.ALL_CLIENT)
  @ApiOperation(
    buildOperationDoc({
      summary: "Get a client",
      description: "Fetch a client by its identifier, including billing accounts and metadata.",
      jwtRoles: [ADMIN_ROLE],
      m2mScopes: [SCOPES.READ_CLIENT, SCOPES.ALL_CLIENT],
    }),
  )
  @ApiOkResponse({ description: "Client found and returned" })
  @ApiParam({ name: "clientId", description: "Client ID" })
  async get(@Param("clientId") id: string) {
    return this.service.get(id);
  }

  @Patch(":clientId")
  @UseGuards(RolesGuard, ScopesGuard)
  @Roles(ADMIN_ROLE)
  @Scopes(SCOPES.UPDATE_CLIENT, SCOPES.ALL_CLIENT)
  @ApiOperation(
    buildOperationDoc({
      summary: "Update a client",
      description: "Update client metadata, billing account associations, or status.",
      jwtRoles: [ADMIN_ROLE],
      m2mScopes: [SCOPES.UPDATE_CLIENT, SCOPES.ALL_CLIENT],
    }),
  )
  @ApiOkResponse({ description: "Client updated" })
  @ApiParam({ name: "clientId", description: "Client ID" })
  @ApiBody({ type: UpdateClientDto })
  async update(@Param("clientId") id: string, @Body() dto: UpdateClientDto) {
    return this.service.update(id, dto);
  }
}
