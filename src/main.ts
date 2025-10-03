import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allow Topcoder domains and localhost for local development
  const allowedDomains = [
    "topcoder.com",
    "topcoder-dev.com",
    // Local dev hosts
    "localhost",
    "127.0.0.1",
  ];
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
  app.setGlobalPrefix("v6");

  const config = app.get(ConfigService);
  // Swagger setup
  const swaggerDescription = [
    "API documentation for Billing Accounts & Clients.",
    "",
    "**Authentication**",
    "- JWT bearer tokens (user tokens) must include the roles listed per endpoint.",
    "- Machine-to-machine bearer tokens must include the scopes listed per endpoint.",
  ].join("\n");

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Billing Accounts API")
    .setDescription(swaggerDescription)
    .setVersion("1.0.0")
    .setBasePath("v6/billing-accounts")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "User JWT token with role claims (e.g. administrator, copilot).",
      },
      "JWT",
    )
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Machine-to-machine token that carries the required scopes in `scope`.",
      },
      "M2M",
    )
    .build();
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("/v6/billing-accounts/api-docs", app, swaggerDoc);

  const port = parseInt(config.get<string>("PORT") || "3000", 10);
  await app.listen(port);

  console.log(`TC Billing Account Service listening on :${port}`);
}
bootstrap();
