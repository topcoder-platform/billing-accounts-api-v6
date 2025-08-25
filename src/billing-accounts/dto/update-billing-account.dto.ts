import { PartialType } from '@nestjs/mapped-types';
import { CreateBillingAccountDto } from './create-billing-account.dto';

export class UpdateBillingAccountDto extends PartialType(CreateBillingAccountDto) {}
