import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

@ApiTags("Health")
@Controller("billing-accounts")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("health")
  @ApiOperation({ summary: "Check the health of the service" })
  @ApiResponse({ status: 200, description: "Service is healthy." })
  @ApiResponse({ status: 503, description: "Service is unhealthy." })
  check() : any {
    return this.healthService.check();
  }
}
