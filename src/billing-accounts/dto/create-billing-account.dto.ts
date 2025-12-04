import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateBillingAccountDto {
  @ApiProperty({ example: "Acme Innovation Billing Account" })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: "218734" })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ example: "Primary billing account for Acme Innovation initiatives." })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: "Globex Corporation" })
  @IsOptional()
  @IsString()
  subcontractingEndCustomer?: string;

  @ApiPropertyOptional({ enum: ["ACTIVE", "INACTIVE"], example: "ACTIVE" })
  @IsOptional()
  @IsString()
  status?: "ACTIVE" | "INACTIVE";

  @ApiPropertyOptional({ example: "2025-01-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: "2025-12-31T23:59:59.000Z" })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ example: 250000 })
  @IsNumber()
  budget!: number;

  @ApiProperty({ example: 0.15 })
  @IsNumber()
  markup!: number;

  @ApiProperty({ example: "client-123456" })
  @IsString()
  clientId!: string;

  @ApiPropertyOptional({ example: "PO-456789" })
  @IsOptional()
  @IsString()
  poNumber?: string;

  @ApiPropertyOptional({ example: "SUB-2024-001" })
  @IsOptional()
  @IsString()
  subscriptionNumber?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isManualPrize?: boolean;

  @ApiPropertyOptional({ example: "Net 30" })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional({ example: 8.75 })
  @IsOptional()
  @IsNumber()
  salesTax?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  billable?: boolean;
}
