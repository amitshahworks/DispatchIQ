# Changelog

All notable changes to this project are documented here.

---

## Phase 1 — Repository Foundation

- Initialized the DispatchIQ monorepo.
- Configured npm workspaces.
- Added ESLint and Prettier.
- Added Vitest foundation tests.
- Added shared constants and utilities.
- Added reusable Zod schemas.
- Configured Dockerized PostgreSQL.
- Configured Prisma ORM 7 with the PostgreSQL driver adapter.
- Verified linting, formatting, automated tests, PostgreSQL readiness, and Prisma Client generation.

---

## Phase 2 — Database Schema & Migration

- Designed the initial PostgreSQL database schema using Prisma ORM 7.
- Added domain models for users, jobs, job attempts, job logs, worker instances, API keys, and refresh tokens.
- Implemented enums covering authorization roles, job lifecycle, priorities, execution attempts, logging, and worker states.
- Configured indexes and constraints for efficient job querying, idempotency, worker recovery, and audit history.
- Applied the initial database migration.
- Verified Prisma schema validation, client generation, database migration, and PostgreSQL connectivity.

---

## Phase 3 — Development Seed Data

- Added a repeatable development database seed.
- Seeded demo users with secure password hashes.
- Seeded representative worker instances across multiple health states.
- Seeded jobs covering the complete lifecycle, including scheduled, queued, processing, retrying, completed, failed, dead-letter, and cancelled states.
- Seeded execution attempts and structured lifecycle logs for realistic development and testing.
- Seeded a development API key.
- Configured Prisma seed execution through `prisma.config.ts`.
- Verified repeatable seeding, schema validation, formatting, linting, and automated tests.

---

## Phase 4 — API Foundation

- Initialized the Express API application and server entry point.
- Configured centralized environment management with runtime validation.
- Added Helmet, CORS, JSON parsing, URL-encoded parsing, and HTTP request logging.
- Implemented root service information (`GET /`) and database health (`GET /health`) endpoints.
- Added centralized error handling for operational errors, malformed JSON requests, and unexpected server failures.
- Added standardized 404 handling for unknown routes.
- Implemented reusable asynchronous route handlers and application error utilities.
- Integrated the shared Prisma database package for connectivity and health checks.
- Added graceful shutdown handling for `SIGINT` and `SIGTERM`.
- Added unit tests for environment configuration and shared utilities.
- Added API integration tests covering health checks, malformed requests, and unknown routes.
- Verified API startup, PostgreSQL connectivity, formatting, linting, Prisma schema validation, and automated tests.

---

## Phase 5 — Authentication & Authorization

- Designed the authentication architecture for API clients.
- Implemented secure JWT access-token authentication.
- Added refresh token rotation with persistent server-side session management.
- Added secure password hashing and verification using bcrypt.
- Implemented user registration, login, token refresh, and logout endpoints.
- Added authentication middleware for protected endpoints.
- Implemented role-based authorization middleware.
- Added centralized request validation using Zod.
- Implemented authentication services following the Controller → Service → Repository architecture.
- Added repositories for user authentication and refresh-token persistence.
- Added comprehensive unit tests covering authentication flows, authorization, validation, controllers, services, middleware, password utilities, and token management.
- Verified authentication workflows, formatting, linting, automated tests, and Prisma schema validation.

---

## Phase 6 — Job Management API

- Designed the Job Management module following a layered architecture (Controller → Service → Repository).
- Implemented authenticated job creation.
- Added transactional job creation with lifecycle audit logging.
- Implemented user-scoped idempotent job creation using idempotency keys.
- Added paginated job listing with filtering by status and job type.
- Added job detail endpoints including execution attempts and lifecycle logs.
- Implemented lifecycle-aware job cancellation.
- Added comprehensive request validation using Zod.
- Added transactional repository operations for job persistence.
- Implemented ownership validation for all job operations.
- Added standardized API response contracts.
- Added comprehensive unit tests covering controllers, services, repositories, routes, and validation.
- Verified formatting, linting, automated tests, and Prisma schema validation.

---

## Phase 7 — Distributed Worker Runtime

- Implemented a production-style distributed worker runtime.
- Added PostgreSQL-based job claiming using `FOR UPDATE SKIP LOCKED`.
- Implemented transactional worker ownership locking to prevent duplicate job execution.
- Added transactional job state transitions.
- Added centralized job processor with a pluggable handler registry.
- Implemented EMAIL, WEBHOOK, and REPORT_GENERATION job handlers.
- Added worker registration and lifecycle management.
- Implemented worker heartbeat scheduling with overlap protection.
- Added configurable worker polling and heartbeat intervals.
- Implemented graceful worker startup and shutdown lifecycle.
- Added graceful shutdown that waits for active job completion before exiting.
- Implemented retry scheduling using exponential backoff.
- Added automatic dead-letter queue transitions after retry exhaustion.
- Added transactional execution-attempt tracking.
- Added structured lifecycle logging throughout job processing.
- Added structured execution metrics for every processing attempt.
- Implemented automatic stale-worker detection.
- Added configurable stale-worker recovery scheduling.
- Implemented deterministic recovery of abandoned processing jobs after worker crashes.
- Added worker recovery repository and service layers.
- Added runtime orchestration for polling, heartbeat, recovery, and graceful shutdown.
- Added standalone worker runtime entry point.
- Added comprehensive unit tests covering runtime orchestration, processors, handlers, repositories, services, recovery, scheduling, and worker lifecycle.
- Added end-to-end integration tests validating the complete execution pipeline from authenticated API request through PostgreSQL persistence, worker execution, and successful job completion.
- Verified formatting, linting, Prisma schema validation, **395 automated unit tests**, and end-to-end integration testing.

---

## Phase 8 — API Keys & Unified Authentication

- Implemented secure API key management for programmatic clients.
- Added cryptographically secure API key generation.
- Added SHA-256 hashing for API key persistence.
- Added API key creation endpoint.
- Added API key listing endpoint.
- Added API key revocation endpoint.
- Added API key repository, service, controller, routes, and validation layers.
- Added API key authentication middleware using the `X-API-Key` header.
- Added unified authentication middleware supporting both JWT and API key authentication.
- Enabled API key authentication for authenticated job submission.
- Preserved JWT-only access for job inspection and lifecycle-management endpoints.
- Added transactional API key last-used timestamp tracking.
- Added comprehensive unit tests covering API key lifecycle, middleware, repositories, services, controllers, routing, validation, and unified authentication.
- Added end-to-end integration tests validating complete machine-to-machine execution from API key authentication through PostgreSQL persistence and distributed worker completion.
- Verified formatting, linting, 560 automated unit tests, 2 end-to-end integration tests, and Prisma schema validation.

---

## Added

### Worker Management API

- Added administrative Worker Management API
- Added worker listing endpoint
- Added worker health endpoint
- Added worker detail endpoint
- Added worker repository
- Added worker service
- Added worker validation
- Added comprehensive unit and route tests
