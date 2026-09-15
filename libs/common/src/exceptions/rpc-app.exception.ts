import { RpcException } from '@nestjs/microservices';
import { HttpStatus } from '@nestjs/common';

export interface RpcErrorPayload {
  statusCode: number;
  message: string;
  error: string;
  details?: unknown;
}

export function throwRpcError(
  statusCode: HttpStatus,
  message: string,
  error?: string,
  details?: unknown,
): never {
  const payload: RpcErrorPayload = {
    statusCode,
    message,
    error: error ?? HttpStatus[statusCode] ?? 'Error',
    ...(details !== undefined ? { details } : {}),
  };
  throw new RpcException(payload);
}

export const RpcErrors = {
  badRequest(message: string, details?: unknown): never {
    return throwRpcError(
      HttpStatus.BAD_REQUEST,
      message,
      'Bad Request',
      details,
    );
  },
  unauthorized(
    message = 'Authentication is required or the provided credentials are invalid',
  ): never {
    return throwRpcError(HttpStatus.UNAUTHORIZED, message, 'Unauthorized');
  },
  forbidden(
    message = 'You do not have permission to access this resource',
  ): never {
    return throwRpcError(HttpStatus.FORBIDDEN, message, 'Forbidden');
  },
  notFound(resource = 'Resource'): never {
    return throwRpcError(
      HttpStatus.NOT_FOUND,
      `${resource} not found`,
      'Not Found',
    );
  },
  conflict(message: string): never {
    return throwRpcError(HttpStatus.CONFLICT, message, 'Conflict');
  },
  serviceUnavailable(message: string): never {
    return throwRpcError(
      HttpStatus.SERVICE_UNAVAILABLE,
      message,
      'Service Unavailable',
    );
  },
  validation(details?: unknown): never {
    return throwRpcError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'The request was well-formed but failed validation',
      'Unprocessable Entity',
      details,
    );
  },
  internal(message = 'An unexpected error occurred on the server'): never {
    return throwRpcError(
      HttpStatus.INTERNAL_SERVER_ERROR,
      message,
      'Internal Server Error',
    );
  },
};
