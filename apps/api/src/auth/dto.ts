import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class NonceRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  stakeAddress!: string;
}

export class VerifyRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  stakeAddress!: string;

  /** COSE_Sign1 cbor hex from CIP-30 signData. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  signature!: string;

  /** COSE_Key cbor hex from CIP-30 signData. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  key!: string;
}
