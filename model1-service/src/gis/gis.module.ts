import { Module } from '@nestjs/common';
import { GisController } from './gis.controller';
import { GisService } from './gis.service';

@Module({
  controllers: [GisController],
  providers: [GisService],
})
export class GisModule {}
