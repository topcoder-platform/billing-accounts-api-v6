import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  NotEquals,
} from "class-validator";
import { BUDGET_ENTRY_EXTERNAL_TYPES } from "../budget-entry.util";
import type { BudgetEntryExternalTypeValue } from "../budget-entry.util";

export class ConsumeAmountDto {
  @ApiProperty({
    example: "12345abcde",
    description:
      "External reference id. For challenges this is the challenge id; for engagements this is the assignment id.",
  })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({
    example: "CHALLENGE",
    enum: BUDGET_ENTRY_EXTERNAL_TYPES,
    default: "CHALLENGE",
    description:
      "Typed external reference. ENGAGEMENT consumed entries are append-only.",
  })
  @IsOptional()
  @IsIn(BUDGET_ENTRY_EXTERNAL_TYPES)
  externalType?: BudgetEntryExternalTypeValue;

  @ApiPropertyOptional({
    example: "12345abcde",
    deprecated: true,
    description: "Deprecated alias for externalId kept for challenge callers.",
  })
  @IsOptional()
  @IsString()
  challengeId?: string;

  @ApiProperty({
    example: 1500,
    minimum: 0,
    exclusiveMinimum: true,
    description: "Positive amount to consume. Zero consumes are rejected.",
  })
  @IsNumber()
  @Min(0)
  @NotEquals(0)
  amount!: number;
}
