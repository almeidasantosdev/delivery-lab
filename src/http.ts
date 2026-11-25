import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, NestInterceptor } from "@nestjs/common";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable } from "rxjs";
import { log } from "./log";
import { httpRequests } from "./metrics";
import { HttpError } from "./validate";

@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpError) {
      response.status(exception.status).json({ error: exception.message });
      return;
    }
    if (exception instanceof SyntaxError || (exception instanceof HttpException && exception.getStatus() === 400)) {
      response.status(400).json({ error: "JSON invalido" });
      return;
    }
    log("error", "erro nao tratado", {
      error: exception instanceof Error ? exception.message : "erro desconhecido",
    });
    response.status(500).json({ error: "erro interno" });
  }
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    response.on("finish", () => {
      const route = request.route?.path ? String(request.route.path) : "unmatched";
      httpRequests.inc({ method: request.method, route, status: String(response.statusCode) });
    });
    return next.handle();
  }
}
