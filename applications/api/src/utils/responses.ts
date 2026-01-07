import { HTTP_STATUS } from "@keeper.sh/constants";

class ErrorResponse {
  private readonly status: number;
  private readonly message: string | null;

  constructor(status: number, message: string | null = null) {
    this.status = status;
    this.message = message;
  }

  toResponse(): Response {
    return Response.json({ error: this.message }, { status: this.status });
  }

  static badRequest(message: string | null = null): ErrorResponse {
    return new ErrorResponse(HTTP_STATUS.BAD_REQUEST, message);
  }

  static unauthorized(message: string | null = null): ErrorResponse {
    return new ErrorResponse(HTTP_STATUS.UNAUTHORIZED, message);
  }

  static paymentRequired(message: string | null = null): ErrorResponse {
    return new ErrorResponse(HTTP_STATUS.PAYMENT_REQUIRED, message);
  }

  static forbidden(message: string | null = null): ErrorResponse {
    return new ErrorResponse(HTTP_STATUS.FORBIDDEN, message);
  }

  static notFound(message: string | null = null): ErrorResponse {
    return new ErrorResponse(HTTP_STATUS.NOT_FOUND, message);
  }

  static conflict(message: string | null = null): ErrorResponse {
    return new ErrorResponse(HTTP_STATUS.CONFLICT, message);
  }

  static tooManyRequests(message: string | null = null): ErrorResponse {
    return new ErrorResponse(HTTP_STATUS.TOO_MANY_REQUESTS, message);
  }

  static notImplemented(message: string | null = null): ErrorResponse {
    return new ErrorResponse(HTTP_STATUS.NOT_IMPLEMENTED, message);
  }

  static internal(message: string | null = null): ErrorResponse {
    return new ErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, message);
  }
}

export { ErrorResponse };
