import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedDomains = ["topcoder.com", "topcoder-dev.com"];
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      try {
        const hostname = new URL(origin).hostname;
        const isAllowed = allowedDomains.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        );
        return isAllowed
          ? callback(null, true)
          : callback(new Error("Origin not allowed by CORS"));
      } catch (err) {
        return callback(err as Error);
      }
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix("v6/billing-accounts");

  const config = app.get(ConfigService);
  // Swagger setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Billing Accounts API")
    .setDescription("API documentation for Billing Accounts & Clients")
    .setVersion("1.0.0")
    .setBasePath("v6/billing-accounts")
    .addBearerAuth()
    .build();
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("/v6/billing-accounts/api-docs", app, swaggerDoc);

  const port = parseInt(config.get<string>("PORT") || "3000", 10);
  await app.listen(port);

  console.log(`TC Billing Account Service listening on :${port}`);
}
bootstrap();
