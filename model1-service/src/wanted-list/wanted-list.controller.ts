import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { WantedListService } from './wanted-list.service';
import { WantedNotificationService } from './wanted-notification.service';
import { CheckPlateQueryDto } from './dto/check-plate-query.dto';
import { CreateWantedVehicleDto } from './dto/create-wanted-vehicle.dto';
import { WantedListQueryDto } from './dto/wanted-list-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CheckPlateResult } from './wanted-list.types';

// check-plate: any signed-in role checks whether a plate is wanted (Vehicle
// Search); a match records a notification so the alert isn't lost once
// this response is read. List/add/resolve: admins maintain the list.
@Controller('wanted-list')
export class WantedListController {
  constructor(
    private readonly wantedListService: WantedListService,
    private readonly notificationService: WantedNotificationService,
  ) {}

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get('check-plate')
  async checkPlate(@Query() query: CheckPlateQueryDto): Promise<CheckPlateResult> {
    const result = await this.wantedListService.checkPlate(query.plate);

    if (result.matched && result.wantedVehicle) {
      await this.notificationService.createManualSearchNotification(
        result.wantedVehicle.wantedVehicleId,
        result.wantedVehicle.plateNumber,
      );
    }

    return result;
  }

  @Roles('admin')
  @Get()
  async list(@Query() query: WantedListQueryDto) {
    return this.wantedListService.listWanted(query.status);
  }

  @Roles('admin')
  @Audit('create_wanted_vehicle', 'wanted_vehicle')
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async create(@Req() request: Request, @Body() dto: CreateWantedVehicleDto) {
    return this.wantedListService.createWanted(request, dto);
  }

  @Roles('admin')
  @Audit('resolve_wanted_vehicle', 'wanted_vehicle')
  @Post(':id/resolve')
  async resolve(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.wantedListService.resolveWanted(request, id);
  }
}
