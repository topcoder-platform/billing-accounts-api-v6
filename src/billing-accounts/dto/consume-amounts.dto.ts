import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  NotEquals,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BUDGET_ENTRY_EXTERNAL_TYPES } from "../budget-entry.util";
import type { BudgetEntryExternalTypeValue } from "../budget-entry.util";

/**
 * Describes one engagement budget consume inside an atomic batch request.
 *
 * Each item carries the target billing account, the engagement assignment id as
 * the external reference, and the positive amount to reserve from the
 * billing-account ledger.
 */
export class ConsumeAmountsItemDto {
  @ApiProperty({
    example: 80001063,
    minimum: 1,
    description: "Billing account id to consume from.",
  })
  @IsInt()
  @Min(1)
  billingAccountId!: number;

  @ApiProperty({
    example: "assignment-123",
    description: "Engagement assignment id to record on the consumed row.",
  })
  @IsString()
  externalId!: string;

  @ApiPropertyOptional({
    example: "ENGAGEMENT",
    enum: BUDGET_ENTRY_EXTERNAL_TYPES,
    default: "ENGAGEMENT",
    description:
      "Typed external reference. Batch consumes only accept ENGAGEMENT entries.",
  })
  @IsOptional()
  @IsIn(BUDGET_ENTRY_EXTERNAL_TYPES)
  externalType?: BudgetEntryExternalTypeValue;

  @ApiPropertyOptional({
    example: "legacy-challenge-id",
    deprecated: true,
    description:
      "Deprecated challenge alias. It is rejected for engagement batch consumes.",
  })
  @IsOptional()
  @IsString()
  challengeId?: string;

  @ApiProperty({
    example: 1500,
    minimum: 0,
    exclusiveMinimum: true,
    description:
      "Positive amount to consume. The service quantizes this to Decimal(20,4).",
  })
  @IsNumber()
  @Min(0)
  @NotEquals(0)
  amount!: number;
}

/**
 * Request body for atomically consuming one or more engagement budget rows.
 *
 * The billing-account service validates all items and writes the consumed rows
 * inside one database transaction so a later item cannot leave earlier remote
 * side effects behind.
 */
export class ConsumeAmountsDto {
  @ApiProperty({
    type: [ConsumeAmountsItemDto],
    description: "Engagement budget consumes to validate and persist together.",
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ConsumeAmountsItemDto)
  consumes!: ConsumeAmountsItemDto[];
}
