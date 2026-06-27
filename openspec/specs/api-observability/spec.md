## Purpose

Provide structured, production-grade observability for the API: a shared JSON logger, per-request correlation ids, request/response lifecycle logging, request-scoped log context propagation, sensitive data redaction, error logging before response dispatch, per-IP rate limiting, and graceful shutdown.

## Requirements

### Requirement: Structured application logger

The API SHALL emit logs through a single shared structured logger. Log output SHALL be machine-parseable JSON in production and human-readable in development, with the minimum severity controlled by configuration (`LOG_LEVEL`, default `info`). Ad-hoc `console.*` calls SHALL be replaced by this logger.

#### Scenario: Production logs are structured JSON
- **WHEN** the API runs with `NODE_ENV=production`
- **THEN** every log line SHALL be a single JSON object including at least a timestamp, level, and message

#### Scenario: Development logs are human-readable
- **WHEN** the API runs in development
- **THEN** logs SHALL be pretty-printed for readability while carrying the same fields

#### Scenario: Log level is configurable
- **WHEN** `LOG_LEVEL` is set (e.g. `debug` or `warn`)
- **THEN** the logger SHALL emit records at that level and above and SHALL suppress lower-severity records

### Requirement: Per-request correlation id

The API SHALL assign a correlation id to every incoming HTTP request. If the inbound request carries an `x-request-id` header, the API SHALL reuse it; otherwise it SHALL generate a unique id. The correlation id SHALL be returned to the client on the response as `X-Request-Id`.

#### Scenario: Request without an id gets one generated
- **WHEN** a request arrives without an `x-request-id` header
- **THEN** the API SHALL generate a unique correlation id for that request
- **AND** SHALL include it as the `X-Request-Id` response header

#### Scenario: Inbound request id is honored
- **WHEN** a request arrives with an `x-request-id` header
- **THEN** the API SHALL use that value as the request's correlation id
- **AND** SHALL echo the same value in the `X-Request-Id` response header

### Requirement: Request and response logging

The API SHALL log the start and completion of each HTTP request with its method, path, response status, and duration, all tagged with the request's correlation id. The log severity SHALL reflect the outcome: success at info, client errors (4xx) at warn, and server errors (5xx) at error.

#### Scenario: Successful request is logged
- **WHEN** a request completes with a 2xx status
- **THEN** the API SHALL emit one completion log at info level including method, path, status, duration, and correlation id

#### Scenario: Server error severity
- **WHEN** a request completes with a 5xx status or throws
- **THEN** the completion log SHALL be emitted at error level with the correlation id

### Requirement: Request-scoped logger available to all code

The API SHALL make a request-scoped logger (bound to that request's correlation id) available both as `req.log` in handlers and, via an async context, to code invoked during the request that does not receive the request object directly (e.g. Stellar transaction building and relay submission). Logs written from such code SHALL carry the originating request's correlation id.

#### Scenario: Deep code logs with the request id
- **WHEN** a route handler calls into transaction-building or relay code that logs
- **THEN** those log lines SHALL include the same correlation id as the originating request without the request object being passed explicitly

### Requirement: Sensitive data redaction

The API SHALL redact secrets and sensitive material from all log output. At minimum this SHALL include `authorization` and `cookie` request headers, signed transaction XDR, Stellar secret keys, and passkey/relay credentials.

#### Scenario: Authorization header is redacted
- **WHEN** a request carrying an `authorization` header is logged
- **THEN** the logged header value SHALL be masked rather than recorded verbatim

#### Scenario: Secrets never appear in logs
- **WHEN** code logs an object that contains a secret key or signed XDR
- **THEN** the secret SHALL be masked or omitted in the emitted log record

### Requirement: Errors are logged before the response is returned

The API's central error handler SHALL log every error it handles — including its message, stack, and the request correlation id — before sending the response. The existing client-facing response shape (`{ error, code, details }`) SHALL be unchanged.

#### Scenario: Handled error is recorded
- **WHEN** a route forwards an error to the central error handler
- **THEN** the API SHALL emit an error-level log with the message, stack, and correlation id
- **AND** SHALL still return the `{ error, code, details }` body with the appropriate status

#### Scenario: Validation error is not lost
- **WHEN** a request fails Zod validation and returns a 400
- **THEN** the API SHALL log the failure at warn level with the correlation id while returning the existing `VALIDATION` error body

### Requirement: Stateless, concurrency-safe request handling

The API SHALL handle concurrent users without cross-request interference. Per-request state SHALL live only in request scope (the request object or async context); the API SHALL NOT store per-user request state in module-level mutable variables that could leak between concurrent requests.

#### Scenario: Concurrent requests do not share correlation ids
- **WHEN** multiple requests are processed simultaneously
- **THEN** each request's logs SHALL carry only its own correlation id with no bleed-over from other in-flight requests

#### Scenario: No per-user state in module scope
- **WHEN** a handler needs request- or user-specific data
- **THEN** it SHALL read and write that data only within request scope, never in shared module-level mutable state

### Requirement: Per-IP rate limiting

The API SHALL apply per-client rate limiting to protect shared upstream resources (Stellar RPC, the sponsoring relay, Postgres) from a single client overwhelming the service. Requests exceeding the limit SHALL receive a `429` response.

#### Scenario: Client exceeding the limit is throttled
- **WHEN** a single client exceeds the configured request rate
- **THEN** the API SHALL respond with HTTP 429
- **AND** SHALL log the throttling event with the client's correlation id

### Requirement: Graceful shutdown

On receiving a termination signal (`SIGTERM`/`SIGINT`), the API SHALL stop accepting new connections, allow in-flight requests to finish within a bounded grace period, and stop the background indexer before exiting.

#### Scenario: In-flight requests drain on shutdown
- **WHEN** the process receives `SIGTERM` while requests are in flight
- **THEN** the API SHALL stop accepting new connections, let in-flight requests complete within the grace period, and then exit

#### Scenario: Background indexer stops on shutdown
- **WHEN** the process is shutting down
- **THEN** the API SHALL stop the periodic indexer so no reconciliation runs after exit begins
