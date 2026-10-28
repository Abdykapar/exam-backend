import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.get<string>('CLIENT_URL', 'http://localhost:3000'),
  });

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('ExamPro API').addBearerAuth().build(),
  );
  SwaggerModule.setup('api/docs', app, doc);

  await app.listen(config.get<number>('PORT', 5000));
}
await bootstrap();
