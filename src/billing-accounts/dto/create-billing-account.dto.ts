import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";

export class CreateBillingAccountDto {
  @IsString() name!: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() status?: "ACTIVE" | "INACTIVE";
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsNumber() budget!: number;
  @IsNumber() markup!: number;
  @IsString() clientId!: string;
  @IsOptional() @IsString() poNumber?: string;
  @IsOptional() @IsString() subscriptionNumber?: string;
  @IsOptional() @IsBoolean() isManualPrize?: boolean;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsNumber() salesTax?: number;
  @IsOptional() @IsBoolean() billable?: boolean;
}
