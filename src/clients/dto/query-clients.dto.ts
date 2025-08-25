import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { Transform } from "class-transformer";

export class QueryClientsDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() codeName?: string;
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE"]) status?: "ACTIVE" | "INACTIVE";
  @IsOptional() @IsDateString() startDateFrom?: string;
  @IsOptional() @IsDateString() startDateTo?: string;
  @IsOptional() @IsDateString() endDateFrom?: string;
  @IsOptional() @IsDateString() endDateTo?: string;

  @IsOptional() @IsString() sortBy?:
    | "name"
    | "startDate"
    | "endDate"
    | "status"
    | "createdAt";
  @IsOptional() @IsIn(["asc", "desc"]) sortOrder?: "asc" | "desc";

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  perPage?: number = 20;
}
