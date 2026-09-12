import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { WantedNotificationService } from './wanted-notification.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: WantedNotificationService) {}

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get()
  async list(@Query() query: NotificationQueryDto) {
    return this.notificationService.listNotifications(query);
  }

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get('unread-count')
  async unreadCount() {
    const count = await this.notificationService.getUnreadCount();
    return { count };
  }

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/read')
  async markRead(@Param('id') id: string) {
    await this.notificationService.markRead(id);
  }

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('read-all')
  async markAllRead() {
    await this.notificationService.markAllRead();
  }
}
