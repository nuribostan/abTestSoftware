import { APIGatewayProxyResult } from "aws-lambda";

// Standart CORS headers
const defaultHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
};

// Başarılı response
export const success = (data: any, statusCode = 200): APIGatewayProxyResult => ({
  statusCode,
  headers: defaultHeaders,
  body: JSON.stringify(data),
});

// Cache'li response (Config API için)
export const successWithCache = (
  data: any,
  maxAge = 60
): APIGatewayProxyResult => ({
  statusCode: 200,
  headers: {
    ... defaultHeaders,
    "Cache-Control": `public, max-age=${maxAge}`,
  },
  body: JSON. stringify(data),
});

// Hata response
export const error = (
  message: string,
  statusCode = 500,
  details?: any
): APIGatewayProxyResult => ({
  statusCode,
  headers: defaultHeaders,
  body: JSON.stringify({
    error: true,
    message,
    details: process.env.DEBUG === "true" ? details : undefined,
  }),
});

// 400 Bad Request
export const badRequest = (message: string): APIGatewayProxyResult =>
  error(message, 400);

// 401 Unauthorized
export const unauthorized = (message = "Unauthorized"): APIGatewayProxyResult =>
  error(message, 401);

// 403 Forbidden
export const forbidden = (message = "Forbidden"): APIGatewayProxyResult =>
  error(message, 403);

// 404 Not Found
export const notFound = (message = "Not found"): APIGatewayProxyResult =>
  error(message, 404);

// CORS preflight response
export const cors = (): APIGatewayProxyResult => ({
  statusCode: 200,
  headers: defaultHeaders,
  body: "",
});