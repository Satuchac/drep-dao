import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // §25 — versioned API under /api/v1; health/metrics stay unprefixed (§25.6).
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'healthz', method: RequestMethod.GET },
      { path: 'internal/healthz', method: RequestMethod.GET },
      { path: 'internal/metrics', method: RequestMethod.GET },
    ],
  });

  const origins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });

  const port = Number(config.get('API_PORT') ?? 4000);
  await app.listen(port);
  Logger.log(`DRep DAO API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
