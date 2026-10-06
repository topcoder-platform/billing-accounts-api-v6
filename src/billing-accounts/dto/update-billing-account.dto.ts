import { PartialType } from "@nestjs/swagger";
import { CreateBillingAccountDto } from "./create-billing-account.dto";

export class UpdateBillingAccountDto extends PartialType(
  CreateBillingAccountDto,
) {}
