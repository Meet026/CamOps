import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ScoringService } from './scoring.service';
import { ScoreLookupDto } from './dto/score-lookup.dto';
import { ScoreLookupPhotoDto } from './dto/score-lookup-photo.dto';
import { VerifyScoringDto } from './dto/verify-scoring.dto';
import { PendingVerificationQueryDto } from './dto/pending-verification-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

@Controller('scoring')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Roles('admin', 'field_officer')
  @Audit('score_camera', 'camera')
  @Post('lookup')
  async lookup(@Req() request: Request, @Body() dto: ScoreLookupDto) {
    return this.scoringService.lookupByBrandModel(dto.cameraId, dto.brand, dto.model, request);
  }

  @Roles('admin', 'field_officer')
  @Audit('score_camera', 'camera')
  @Post('lookup/photo')
  async lookupByPhoto(@Req() request: Request, @Body() dto: ScoreLookupPhotoDto) {
    return this.scoringService.lookupByPhoto(dto.cameraId, request);
  }

  @Roles('admin')
  @Get('pending-verification')
  async listPendingVerifications(@Query() query: PendingVerificationQueryDto) {
    return this.scoringService.listPendingVerifications(query);
  }

  @Roles('admin', 'field_officer')
  @Get('vendor-lookup/brands')
  async listBrands() {
    return this.scoringService.listKnownBrands();
  }

  @Roles('admin')
  @Audit('verify_scoring', 'scoring_verification')
  @Post('verify/:verificationId')
  async verify(
    @Req() request: Request,
    @Param('verificationId') verificationId: string,
    @Body() dto: VerifyScoringDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.scoringService.verifyScoring(
      verificationId,
      dto.decision,
      dto.finalOnvifStatus,
      currentUser,
      request,
    );
  }
}
