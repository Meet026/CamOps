import { Controller, Get, Query } from '@nestjs/common';
import { GisService } from './gis.service';
import { MapBoundsQueryDto } from './dto/map-bounds-query.dto';
import { GapAnalysisQueryDto } from './dto/gap-analysis-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

@Controller('gis')
export class GisController {
  constructor(private readonly gisService: GisService) {}

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get('cameras-in-bounds')
  async getCamerasInBounds(
    @Query() query: MapBoundsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.gisService.getCamerasInBounds(query, currentUser);
  }

  @Roles('admin', 'field_officer')
  @Get('gap-analysis')
  async getGapAnalysis(@Query() query: GapAnalysisQueryDto) {
    return this.gisService.getGapAnalysis(query);
  }

  @Roles('admin', 'field_officer')
  @Get('heatmap')
  getHeatmap() {
    return this.gisService.getHeatmap();
  }
}
