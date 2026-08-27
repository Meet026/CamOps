import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CameraRegistryService } from './camera-registry.service';
import { BulkUploadService } from './bulk-upload/bulk-upload.service';
import { CameraExportService } from './export/camera-export.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { CameraQueryDto } from './dto/camera-query.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

@Controller('cameras')
export class CameraRegistryController {
  constructor(
    private readonly cameraRegistryService: CameraRegistryService,
    private readonly bulkUploadService: BulkUploadService,
    private readonly cameraExportService: CameraExportService,
  ) {}

  @Roles('admin', 'field_officer')
  @Audit('create_camera', 'camera')
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async create(@Body() dto: CreateCameraDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.cameraRegistryService.createCamera(dto, currentUser.userId);
  }

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get()
  async list(@Query() query: CameraQueryDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.cameraRegistryService.listCameras(query, currentUser);
  }

  // Must be declared before getOne's @Get(':id') below — NestJS matches
  // routes in declaration order within a controller, and the more specific
  // literal path segment "bulk" needs to win against the general :id
  // pattern for a request like GET /cameras/bulk/<jobId>.
  @Roles('admin', 'field_officer')
  @Get('bulk/:jobId')
  async getBulkJobStatus(@Param('jobId') jobId: string) {
    return this.bulkUploadService.getJobStatus(jobId);
  }

  // Must be declared before getOne's @Get(':id') below, for the same
  // route-ordering reason as getBulkJobStatus above — the literal path
  // segment "export" needs to win against the general :id pattern.
  @Roles('admin', 'auditor')
  @Get('export')
  async exportCsv(
    @Query() query: CameraQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const cameras = await this.cameraRegistryService.listCamerasUnpaginated(
      {
        departmentId: query.departmentId,
        cameraType: query.cameraType,
        integrationScore: query.integrationScore,
        currentStatus: query.currentStatus,
        isActive: query.isActive,
        search: query.search,
      },
      currentUser,
    );

    const csv = this.cameraExportService.generateCsv(cameras);
    const timestamp = new Date().toISOString().slice(0, 10);

    response.setHeader('Content-Type', 'text/csv');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="cameras-export-${timestamp}.csv"`,
    );
    response.send(csv);
  }

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.cameraRegistryService.getCameraById(id, currentUser);
  }

  @Roles('admin', 'field_officer')
  @Audit('update_camera', 'camera')
  @Patch(':id')
  async update(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCameraDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.cameraRegistryService.updateCamera(request, id, dto, currentUser);
  }

  @Roles('admin', 'field_officer')
  @Audit('update_camera', 'camera')
  @UseInterceptors(FileInterceptor('file'))
  @Post(':id/photo')
  async uploadPhoto(
    @Req() request: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.cameraRegistryService.updateCameraPhoto(request, id, file.buffer, currentUser);
  }

  @Roles('admin')
  @Audit('delete_camera', 'camera')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(
    @Req() request: Request,
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.cameraRegistryService.softDeleteCamera(request, id, currentUser);
  }

  @Roles('admin', 'field_officer')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('bulk')
  async uploadBulk(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.bulkUploadService.createJob(file.buffer, currentUser.userId);
  }
}
