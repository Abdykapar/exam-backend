import { Module } from '@nestjs/common';
import { AttemptsModule } from '../attempts/attempts.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

// CategoriesModule registers the Category model, needed to populate exam.category
@Module({
  imports: [AttemptsModule, CategoriesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
