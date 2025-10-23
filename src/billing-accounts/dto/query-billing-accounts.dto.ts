import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Transform } from "class-transformer";

export class QueryBillingAccountsDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE"]) status?: "ACTIVE" | "INACTIVE";
  @IsOptional() @IsString() name?: string;

  // Date range filters (UI sends From/To as the same day)
  @IsOptional() @IsDateString() startDateFrom?: string;
  @IsOptional() @IsDateString() startDateTo?: string;
  @IsOptional() @IsDateString() endDateFrom?: string;
  @IsOptional() @IsDateString() endDateTo?: string;

  @IsOptional() @IsString() sortBy?:
    | "endDate"
    | "startDate"
    | "id"
    | "createdAt"
    | "createdBy"
    | "remainingBudget";
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
