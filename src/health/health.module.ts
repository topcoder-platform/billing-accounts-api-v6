import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { ClientsModule } from "../clients/clients.module";

@Module({
  imports: [ClientsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
