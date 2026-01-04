import { HTTP_STATUS } from "@keeper.sh/shared";

export class ErrorResponse {
  private static create(status: number, message: string | null): Response {
    return Response.json({ error: message }, { status });
  }

  static badRequest(message: string | null = null): Response {
    return this.create(HTTP_STATUS.BAD_REQUEST, message);
  }

  static unauthorized(message: string | null = null): Response {
    return this.create(HTTP_STATUS.UNAUTHORIZED, message);
  }

  static paymentRequired(message: string | null = null): Response {
    return this.create(HTTP_STATUS.PAYMENT_REQUIRED, message);
  }

  static forbidden(message: string | null = null): Response {
    return this.create(HTTP_STATUS.FORBIDDEN, message);
  }

  static notFound(message: string | null = null): Response {
    return this.create(HTTP_STATUS.NOT_FOUND, message);
  }

  static conflict(message: string | null = null): Response {
    return this.create(HTTP_STATUS.CONFLICT, message);
  }

  static tooManyRequests(message: string | null = null): Response {
    return this.create(HTTP_STATUS.TOO_MANY_REQUESTS, message);
  }

  static notImplemented(message: string | null = null): Response {
    return this.create(HTTP_STATUS.NOT_IMPLEMENTED, message);
  }

  static internal(message: string | null = null): Response {
    return this.create(HTTP_STATUS.INTERNAL_SERVER_ERROR, message);
  }
}
