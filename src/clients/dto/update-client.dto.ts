import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsOptional, IsString } from "class-validator";

export class UpdateClientDto {
  @ApiPropertyOptional({ example: "Acme Corporation" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: "Acme R&D" })
  @IsOptional()
  @IsString()
  codeName?: string;

  @ApiPropertyOptional({ enum: ["ACTIVE", "INACTIVE"], example: "INACTIVE" })
  @IsOptional()
  @IsIn(["ACTIVE", "INACTIVE"])
  status?: "ACTIVE" | "INACTIVE";

  @ApiPropertyOptional({ example: "2024-07-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: "2025-07-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
