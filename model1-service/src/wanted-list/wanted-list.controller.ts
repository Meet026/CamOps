import { Controller, Get, Query } from '@nestjs/common';
import { WantedListService } from './wanted-list.service';
import { WantedNotificationService } from './wanted-notification.service';
import { CheckPlateQueryDto } from './dto/check-plate-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CheckPlateResult } from './wanted-list.types';

// Read-only: this table is populated and maintained outside this app (see
// wanted-list.service.ts) — the only capability exposed here is checking
// whether a plate number is currently on the wanted list, used by Vehicle
// Search when an officer types a plate for a manual sighting. A match
// also records a notification (surfaced via the bell/notification center)
// so the alert isn't lost the moment this response is read.
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
}
