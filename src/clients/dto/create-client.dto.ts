import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class CreateClientDto {
  @ApiProperty({ example: "Acme Corporation" })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: "Acme R&D" })
  @IsOptional()
  @IsString()
  codeName?: string;

  @ApiPropertyOptional({ enum: ["ACTIVE", "INACTIVE"], example: "ACTIVE" })
  @IsOptional()
  @IsIn(["ACTIVE", "INACTIVE"])
  status?: "ACTIVE" | "INACTIVE";

  @ApiPropertyOptional({ example: "2024-05-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: "2025-05-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CreateClientRequestDto {
  // Request body shape: { "param": { ...CreateClientDto } }
  @ApiProperty({
    example: {
      param: {
        name: "Acme Corporation",
        codeName: "Acme R&D",
        status: "ACTIVE",
        startDate: "2024-05-01T00:00:00.000Z",
        endDate: "2025-05-01T00:00:00.000Z",
      },
    },
  })
  @ValidateNested()
  @Type(() => CreateClientDto)
  param!: CreateClientDto;
}
