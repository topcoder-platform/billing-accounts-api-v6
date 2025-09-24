import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { buildOperationDoc } from "../common/swagger/swagger-auth.util";

@ApiTags("Health")
@Controller("billing-accounts")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("health")
  @ApiOperation(
    buildOperationDoc({
      summary: "Check service health",
      description: "Verify that the Billing Accounts API and its dependencies respond as expected.",
      publicAccess: true,
    }),
  )
  @ApiResponse({ status: 200, description: "Service is healthy." })
  @ApiResponse({ status: 503, description: "Service is unhealthy." })
  check() : any {
    return this.healthService.check();
  }
}
