import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OfflineService } from './offline.service.js';
import {
  CreateOfflineSessionDto,
  CreateSheetDto,
  ListOfflineSessionsQueryDto,
  PdfQueryDto,
  UpdateSheetDto,
} from './dto/offline.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { Role } from '../users/schemas/user.schema.js';
import type { JwtUser } from '../common/types.js';

const attachment = (filename: string) => `attachment; filename="${filename}"`;

@ApiTags('offline')
@ApiBearerAuth()
@Roles(Role.Instructor, Role.Admin)
@Controller('offline-sessions')
export class OfflineController {
  constructor(private service: OfflineService) {}

  @Post()
  create(@Body() dto: CreateOfflineSessionDto, @CurrentUser() u: JwtUser) {
    return this.service.create(dto, u);
  }

  @Get()
  list(@Query() q: ListOfflineSessionsQueryDto, @CurrentUser() u: JwtUser) {
    return this.service.list(u, q);
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() u: JwtUser) {
    return this.service.get(id, u);
  }

  @Delete(':id')
  remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() u: JwtUser) {
    return this.service.remove(id, u);
  }

  @Get(':id/sheets')
  sheets(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() u: JwtUser) {
    return this.service.listSheets(id, u);
  }

  @Post(':id/sheets')
  addSheet(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateSheetDto,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.addSheet(id, u, dto);
  }

  @Patch(':id/sheets/:sheetId')
  updateSheet(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('sheetId', ParseObjectIdPipe) sheetId: string,
    @Body() dto: UpdateSheetDto,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.updateSheet(id, sheetId, u, dto);
  }

  @Delete(':id/sheets/:sheetId')
  removeSheet(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('sheetId', ParseObjectIdPipe) sheetId: string,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.removeSheet(id, sheetId, u);
  }

  @Get(':id/results.csv')
  async csv(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() u: JwtUser) {
    const { filename, csv } = await this.service.resultsCsv(id, u);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: attachment(filename),
    });
  }

  /** kind: answer-sheet | booklet | answer-key; ?variant=A for one version, otherwise all */
  @Get(':id/pdf/:kind')
  async pdf(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('kind') kind: string,
    @Query() q: PdfQueryDto,
    @CurrentUser() u: JwtUser,
  ) {
    const { filename, pdf } = await this.service.pdf(id, u, kind, q.variant);
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: attachment(filename) });
  }
}
