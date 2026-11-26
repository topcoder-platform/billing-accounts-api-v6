import { createPostgresAdapter } from "../prisma-adapter";
import { INestApplication, Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      adapter: createPostgresAdapter(process.env.DATABASE_URL),
      transactionOptions: {
        timeout: process.env.BA_SERVICE_PRISMA_TIMEOUT
          ? parseInt(process.env.BA_SERVICE_PRISMA_TIMEOUT, 10)
          : 10000,
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  enableShutdownHooks(app: INestApplication) {
    (this as any).$on("beforeExit", () => {
      void app.close();
    });
  }
}
