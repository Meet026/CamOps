import { Module } from '@nestjs/common';
import { WantedListController } from './wanted-list.controller';
import { NotificationsController } from './notifications.controller';
import { WantedListService } from './wanted-list.service';
import { WantedNotificationService } from './wanted-notification.service';

@Module({
  controllers: [WantedListController, NotificationsController],
  providers: [WantedListService, WantedNotificationService],
  exports: [WantedListService, WantedNotificationService],
})
export class WantedListModule {}
