import { Inject, Injectable, Module, type OnModuleDestroy } from "@nestjs/common";
import { readConfig } from "./config";
import { createPgDb, type Db } from "./db";

export const DB = "DB";

@Injectable()
export class DatabaseCloser implements OnModuleDestroy {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleDestroy(): Promise<void> {
    await this.db.close();
  }
}

@Module({
  providers: [
    {
      provide: DB,
      useFactory: async (): Promise<Db> => {
        const config = readConfig(process.env);
        const db = createPgDb(config.databaseUrl);
        await db.migrate();
        return db;
      },
    },
    DatabaseCloser,
  ],
  exports: [DB],
})
export class DatabaseModule {}
