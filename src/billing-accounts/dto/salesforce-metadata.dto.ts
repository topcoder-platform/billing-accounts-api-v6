import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, Matches } from "class-validator";

/** Optional Salesforce metadata accepted by create/update APIs, including explicit null clears. */
export class BillingAccountSalesforceMetadataDto {
  @ApiPropertyOptional({
    description:
      "Salesforce billing-account ID; independent of the numeric local ID.",
    nullable: true,
    maxLength: 18,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  @Matches(/^[a-zA-Z0-9]{18}$/, {
    message: "Must be an 18-character Salesforce ID",
  })
  salesforceBillingAccountId?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce billing-account classification.",
    nullable: true,
    maxLength: 255,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  billingAccountType?: string | null;

  @ApiPropertyOptional({
    description:
      "Salesforce billing notes; separate from the legacy description.",
    nullable: true,
    maxLength: 32768,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32768)
  billingNotes?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce billing frequency label.",
    nullable: true,
    maxLength: 255,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  billingFrequency?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce Opportunity ID.",
    nullable: true,
    maxLength: 18,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  @Matches(/^[a-zA-Z0-9]{18}$/, {
    message: "Must be an 18-character Salesforce ID",
  })
  opportunity?: string | null;

  @ApiPropertyOptional({
    description:
      "Salesforce Subscription ID; separate from subscriptionNumber.",
    nullable: true,
    maxLength: 18,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  @Matches(/^[a-zA-Z0-9]{18}$/, {
    message: "Must be an 18-character Salesforce ID",
  })
  subscription?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce User ID for the primary point of contact.",
    nullable: true,
    maxLength: 18,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  @Matches(/^[a-zA-Z0-9]{18}$/, {
    message: "Must be an 18-character Salesforce ID",
  })
  spoc?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce User ID for the secondary point of contact.",
    nullable: true,
    maxLength: 18,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  @Matches(/^[a-zA-Z0-9]{18}$/, {
    message: "Must be an 18-character Salesforce ID",
  })
  secondarySpoc?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce cost center label.",
    nullable: true,
    maxLength: 255,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  costCenter?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce Workday contract number.",
    nullable: true,
    maxLength: 255,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  workdayContractNumber?: string | null;
}
