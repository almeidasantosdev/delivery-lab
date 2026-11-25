import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { ApiController } from "./api.controller";
import { DatabaseModule } from "./database.module";
import { ApiExceptionFilter, MetricsInterceptor } from "./http";

@Module({
  imports: [DatabaseModule],
  controllers: [ApiController],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule {}
