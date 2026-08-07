# DispatchIQ

<p align="center">
  <strong>A Production-Inspired Distributed Background Job Processing Platform</strong>
</p>

<p align="center">
  Build reliable background job processing with transactional PostgreSQL queues, distributed workers, automatic retries, dead-letter queues, heartbeat monitoring, and crash recovery.
</p>

<p align="center">

![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-black?logo=express)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)
![Vitest](https://img.shields.io/badge/Vitest-395%2B%20Tests-6E9F18?logo=vitest)
![Docker](https://img.shields.io/badge/Docker-Enabled-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

</p>

---

# Overview

DispatchIQ is a production-inspired distributed task queue built with **Node.js**, **Express**, **PostgreSQL**, and **Prisma ORM**.

It demonstrates how modern backend systems safely execute background jobs across multiple worker processes using transactional database operations, worker coordination, retry scheduling, heartbeat monitoring, stale-worker recovery, and comprehensive lifecycle auditing.

The project focuses on reliability, fault tolerance, and clean software architecture rather than framework complexity.

---

# Architecture

```text
                    Clients
                       │
                       ▼
                REST API (Express)
                       │
                       ▼
                PostgreSQL Database
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
    Worker A       Worker B       Worker C
        │              │              │
        └──────────────┼──────────────┘
                       ▼
               Job Handler Registry
          ┌────────┬─────────┬─────────┐
          ▼        ▼         ▼
       EMAIL   WEBHOOK   REPORT_GENERATION
```

---

# Key Features

## Authentication

- JWT Access Token authentication
- Refresh Token rotation
- Secure bcrypt password hashing
- Role-Based Access Control (RBAC)
- Zod request validation
- Session management

---

## Job Management

- Authenticated job creation
- User-scoped idempotency keys
- Scheduled jobs
- Priority queues
- Paginated job listing
- Job detail endpoint
- Lifecycle-aware cancellation
- Ownership validation

---

## Distributed Worker Runtime

- PostgreSQL transactional queue
- `FOR UPDATE SKIP LOCKED`
- Multiple worker support
- Atomic job claiming
- Worker heartbeat monitoring
- Graceful startup
- Graceful shutdown
- Automatic retry scheduling
- Exponential backoff
- Dead Letter Queue
- Crash recovery
- Stale worker detection
- Automatic job recovery

---

## Reliability

- Transaction-safe execution
- Structured lifecycle logging
- Execution attempt tracking
- Worker ownership locking
- Audit history
- Recovery scheduling
- Fault-tolerant execution

---

## Developer Experience

- Dockerized PostgreSQL
- Prisma ORM
- ESLint
- Prettier
- Vitest
- Comprehensive seed data
- Layered architecture

---

# Technology Stack

| Layer            | Technology              |
| ---------------- | ----------------------- |
| Language         | JavaScript (ES Modules) |
| Runtime          | Node.js 24              |
| API              | Express 5               |
| Database         | PostgreSQL 17           |
| ORM              | Prisma ORM 7            |
| Validation       | Zod                     |
| Authentication   | JWT                     |
| Password Hashing | bcrypt                  |
| Testing          | Vitest                  |
| Containerization | Docker                  |

---

# Project Structure

```text
DispatchIQ/

apps/
├── api/
├── worker/
└── web/

packages/
├── database/
├── shared/
└── validation/

tests/

docs/

compose.yaml
```

---

# Database Models

- User
- RefreshToken
- APIKey
- Job
- JobAttempt
- JobLog
- WorkerInstance

---

# Job Lifecycle

```text
SCHEDULED
      │
      ▼
QUEUED
      │
      ▼
PROCESSING
      │
 ┌────┴────┐
 ▼         ▼
SUCCESS   FAILURE
 │         │
 ▼         ▼
COMPLETED RETRYING
             │
             ▼
        PROCESSING
             │
             ▼
       DEAD_LETTER
```

---

# Worker Lifecycle

```text
STARTING
     │
     ▼
ONLINE
     │
     ▼
BUSY
     │
     ▼
ONLINE
     │
     ▼
STOPPING
     │
     ▼
OFFLINE
```

---

# API Overview

| Method | Endpoint           | Description          |
| ------ | ------------------ | -------------------- |
| POST   | `/auth/register`   | Register a user      |
| POST   | `/auth/login`      | Authenticate user    |
| POST   | `/auth/refresh`    | Refresh access token |
| POST   | `/auth/logout`     | Revoke refresh token |
| POST   | `/jobs`            | Create a job         |
| GET    | `/jobs`            | List jobs            |
| GET    | `/jobs/:id`        | Job details          |
| PATCH  | `/jobs/:id/cancel` | Cancel a job         |

---

# Getting Started

## Clone

```bash
git clone https://github.com/amitshahworks/DispatchIQ.git

cd DispatchIQ
```

---

## Install

```bash
npm install
```

---

## Start PostgreSQL

```bash
docker compose up -d postgres
```

---

## Configure Environment

```bash
cp .env.example .env
```

Update the environment variables as needed.

---

## Generate Prisma Client

```bash
npm run prisma:generate
```

---

## Apply Database Migration

```bash
npx prisma migrate dev
```

---

## Seed Development Data

```bash
npm run prisma:seed
```

---

## Run API

```bash
npm run dev:api
```

---

## Run Worker

```bash
npm run dev:worker
```

---

# Environment Variables

| Variable                     | Description                 |
| ---------------------------- | --------------------------- |
| DATABASE_URL                 | PostgreSQL connection       |
| PORT                         | API server port             |
| JWT_ACCESS_SECRET            | JWT signing secret          |
| JWT_ACCESS_EXPIRES_IN        | Token lifetime              |
| REFRESH_TOKEN_EXPIRES_DAYS   | Refresh token expiry        |
| WORKER_HOSTNAME              | Worker identifier           |
| WORKER_POLL_INTERVAL_MS      | Queue polling interval      |
| WORKER_HEARTBEAT_INTERVAL_MS | Heartbeat interval          |
| WORKER_RETRY_BASE_DELAY_MS   | Retry backoff               |
| WORKER_RETRY_MAX_DELAY_MS    | Maximum retry delay         |
| WORKER_RECOVERY_INTERVAL_MS  | Recovery scheduler interval |

---

# Testing

Run the complete test suite.

```bash
npm test
```

Run integration tests.

```bash
npm run test:integration
```

Validate Prisma schema.

```bash
npm run prisma:validate
```

Run linting.

```bash
npm run lint
```

Format code.

```bash
npm run format
```

---

# Current Progress

## Completed

- Repository Foundation
- Database Schema
- Development Seed Data
- API Foundation
- Authentication & Authorization
- Job Management API
- Distributed Worker Runtime
- Heartbeat Monitoring
- Worker Recovery
- Retry Scheduling
- Dead Letter Queue
- Integration Testing

---

# Quality Metrics

- 395+ Automated Unit Tests
- End-to-End Integration Testing
- Prisma Schema Validation
- Dockerized Development Environment
- PostgreSQL Transactional Queue
- Layered Architecture
- Transaction-Safe Worker Coordination
- Automatic Crash Recovery
- Fault-Tolerant Job Execution

---

# Roadmap

- [x] Repository Foundation
- [x] Database Schema
- [x] Development Seed Data
- [x] API Foundation
- [x] Authentication & Authorization
- [x] Job Management API
- [x] Distributed Worker Runtime
- [x] Worker Recovery
- [ ] Metrics Dashboard
- [ ] Worker Monitoring UI
- [ ] Queue Analytics
- [ ] Prometheus Metrics
- [ ] Kubernetes Deployment
- [ ] CI/CD Pipeline

---

# License

This project is licensed under the MIT License.
