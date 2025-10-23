import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, IsString } from "class-validator";

export class LockAmountDto {
  @ApiProperty({ example: "12345abcde" })
  @IsString()
  challengeId!: string;

  @ApiProperty({ example: 1500 })
  @IsNumber()
  amount!: number; // if 0, unlock
}
