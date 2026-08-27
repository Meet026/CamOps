# API Architecture

## Versioning

Every route is served under the `/api/v1` prefix, except `/livez`, which is excluded so ops/load-balancer probes don't need to know about API versioning. This was set up in Phase 1 (Task 4), before any business functionality existed, since retrofitting a prefix once external consumers (Models 2-5, per the PRD's Section 12 extension point) depend on the API is expensive.

## Error Response Shape

Every error response — whether a validation failure, an authentication/authorization rejection, or an unhandled exception — has the same JSON shape, produced by the global `AllExceptionsFilter`:

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "UNAUTHORIZED",
  "correlationId": "74579981-2bb6-43cd-a572-3a323a3ec992"
}
```

An unhandled (non-`HttpException`) error always collapses to `statusCode: 500`, `message: "Internal server error"` — the real error message and stack trace are logged server-side only, keyed by `correlationId`, and never appear in the response body.

## Pagination

List endpoints use the shared `PaginationDto`: `page` defaults to `1`, `limit` defaults to `25` with a maximum of `100`. A request for `limit` above `100` is rejected with HTTP 400, never silently capped.

## Correlation IDs

Every request gets a correlation ID — either reused from an incoming `x-correlation-id` request header, or generated fresh as a UUID. It's echoed back in the `x-correlation-id` response header, included in every error response body, and attached to every `audit_log` row's `metadata`, so a single user action can be traced end-to-end across logs and the audit trail.

## Rate Limiting

`@nestjs/throttler` enforces two tiers:

| Scope | Limit |
|---|---|
| Global default (all routes) | 100 requests / minute / IP |
| `POST /auth/login` | 5 requests / minute / IP |

Exceeding a limit returns HTTP 429. The stricter login override exists because login is a brute-force target; the same override pattern is intended for `POST /cameras/bulk` once the camera-registry module is built.

## Authentication

All routes require a valid JWT access token (`Authorization: Bearer <token>`) unless explicitly marked `@Public()`. See `security.md` for the full authentication design.
