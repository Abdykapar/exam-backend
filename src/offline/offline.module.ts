import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  OfflineSession,
  OfflineSessionSchema,
} from './schemas/offline-session.schema.js';
import { OfflineSheet, OfflineSheetSchema } from './schemas/offline-sheet.schema.js';
import { ExamsModule } from '../exams/exams.module.js';
import { OfflineController } from './offline.controller.js';
import { OfflineService } from './offline.service.js';
import { OmrClient } from './omr.client.js';

@Module({
  imports: [
    ExamsModule,
    MongooseModule.forFeature([
      { name: OfflineSession.name, schema: OfflineSessionSchema },
      { name: OfflineSheet.name, schema: OfflineSheetSchema },
    ]),
  ],
  controllers: [OfflineController],
  providers: [OfflineService, OmrClient],
})
export class OfflineModule {}
