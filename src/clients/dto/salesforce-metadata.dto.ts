import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, Matches } from "class-validator";

/** Optional Salesforce metadata accepted by create/update APIs, including explicit null clears. */
export class ClientSalesforceMetadataDto {
  @ApiPropertyOptional({
    description: "Salesforce Account ID; independent of the local client ID.",
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
  salesforceAccountId?: string | null;

  @ApiPropertyOptional({
    description:
      "Salesforce CRM lifecycle status; independent of ACTIVE/INACTIVE.",
    nullable: true,
    maxLength: 255,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  accountStatus?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce billing street, including multiline addresses.",
    nullable: true,
    maxLength: 255,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  billingStreet?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce billing city.",
    nullable: true,
    maxLength: 40,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  billingCity?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce billing state or province.",
    nullable: true,
    maxLength: 80,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  billingState?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce billing postal code.",
    nullable: true,
    maxLength: 20,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  billingPostalCode?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce billing country.",
    nullable: true,
    maxLength: 80,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  billingCountry?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce account phone.",
    nullable: true,
    maxLength: 40,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce account website.",
    nullable: true,
    maxLength: 255,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string | null;

  @ApiPropertyOptional({
    description: "Salesforce industry label.",
    nullable: true,
    maxLength: 255,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  industry?: string | null;

  @ApiPropertyOptional({
    description: "Parent Salesforce Account ID; not a local Client ID.",
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
  parentId?: string | null;

  @ApiPropertyOptional({
    description:
      "Account-level Salesforce payment terms; independent of billing-account terms.",
    nullable: true,
    maxLength: 255,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentTerms?: string | null;
}
