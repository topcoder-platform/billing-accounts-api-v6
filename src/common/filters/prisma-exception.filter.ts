import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const map: Record<string, number> = {
      P2002: HttpStatus.CONFLICT, // unique constraint failed
      P2025: HttpStatus.NOT_FOUND, // record not found
    };

    const status = map[exception.code] || HttpStatus.BAD_REQUEST;
    response
      .status(status)
      .json({ message: exception.message, code: exception.code });
  }
}
