import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

const LOCK_AMOUNT_EXTERNAL_TYPES = ["CHALLENGE"] as const;
type LockAmountExternalType = (typeof LOCK_AMOUNT_EXTERNAL_TYPES)[number];

export class LockAmountDto {
  @ApiProperty({
    example: "12345abcde",
    description:
      "External reference id. For challenge locks this is the challenge id.",
  })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({
    example: "CHALLENGE",
    enum: LOCK_AMOUNT_EXTERNAL_TYPES,
    default: "CHALLENGE",
    description:
      "Typed external reference. Locking currently supports CHALLENGE only.",
  })
  @IsOptional()
  @IsIn(LOCK_AMOUNT_EXTERNAL_TYPES)
  externalType?: LockAmountExternalType;

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
    description: "Non-negative amount to lock. Use 0 to unlock.",
  })
  @IsNumber()
  @Min(0)
  amount!: number; // if 0, unlock
}
