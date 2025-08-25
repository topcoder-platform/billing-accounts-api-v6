import { IsNumber, IsString } from 'class-validator';

export class LockAmountDto {
  @IsString() challengeId!: string;
  @IsNumber() amount!: number; // if 0, unlock
}
