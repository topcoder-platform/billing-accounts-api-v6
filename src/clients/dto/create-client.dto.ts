import { IsDateString, IsIn, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class CreateClientDto {
  @IsString() name!: string;
  @IsOptional() @IsString() codeName?: string;
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE"]) status?: "ACTIVE" | "INACTIVE";
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

export class CreateClientRequestDto {
  // Request body shape: { "param": { ...CreateClientDto } }
  @ValidateNested()
  @Type(() => CreateClientDto)
  param!: CreateClientDto;
}
