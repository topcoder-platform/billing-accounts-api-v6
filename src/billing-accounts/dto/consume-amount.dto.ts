import { IsNumber, IsString } from "class-validator";

export class ConsumeAmountDto {
  @IsString() challengeId!: string;
  @IsNumber() amount!: number;
}
