import { IsIn, IsOptional, ValidateIf } from 'class-validator';

const DECISIONS = ['confirm', 'reject'] as const;
const ONVIF_STATUSES = ['yes', 'no'] as const;

export class VerifyScoringDto {
  @IsIn(DECISIONS)
  decision!: (typeof DECISIONS)[number];

  // Required when decision === 'confirm', forbidden when decision === 'reject'
  // (validated explicitly in ScoringService.verifyScoring, since
  // class-validator's @ValidateIf can express "required if" but not cleanly
  // "forbidden if" with a clear error message).
  @ValidateIf((o: VerifyScoringDto) => o.decision === 'confirm')
  @IsIn(ONVIF_STATUSES)
  @IsOptional()
  finalOnvifStatus?: (typeof ONVIF_STATUSES)[number];
}
