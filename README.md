# DispatchIQ

> A production-oriented distributed background job orchestration platform built with Node.js, PostgreSQL, Prisma, React, and Docker.

![Status](https://img.shields.io/badge/status-active-success)
![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js)
![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Overview

DispatchIQ is a distributed background job processing platform designed to simulate the architecture used in modern production systems.

It separates API servers from worker processes, allowing jobs to be queued, processed asynchronously, retried automatically, and monitored independently.

The project is being built to demonstrate production-grade backend engineering practices including:

- Distributed job processing
- Reliable asynchronous execution
- Worker orchestration
- Database-driven queues
- Retry mechanisms
- Dead-letter handling
- REST APIs
- Authentication & authorization
- Modular monorepo architecture

---

## Tech Stack

### Backend

- Node.js
- Express.js
- PostgreSQL
- Prisma ORM
- Zod

### Frontend

- React
- Vite

### Tooling

- Docker
- npm Workspaces
- ESLint
- Prettier
- Vitest

---

## Architecture

```
Client
   │
   ▼
REST API
   │
   ▼
PostgreSQL Queue
   ▲
   │
Worker Processes
```

---

## Current Progress

- ✅ Monorepo architecture
- ✅ Docker development environment
- ✅ Prisma database schema
- ✅ Initial database migration
- ✅ Shared packages
- ✅ Validation setup
- ✅ Testing infrastructure

### In Progress

- Authentication
- Job processing engine
- Worker implementation
- Dashboard
- Metrics API

---

## Project Structure

```text
DispatchIQ/
│
├── apps/
│   ├── api/
│   ├── worker/
│   └── web/
│
├── packages/
│   ├── database/
│   ├── shared/
│   └── validation/
│
├── docs/
├── compose.yaml
└── README.md
```

---

## Getting Started

### Clone

```bash
git clone https://github.com/amitshahworks/DispatchIQ.git
cd DispatchIQ
```

### Install

```bash
npm install
```

### Start PostgreSQL

```bash
docker compose up -d postgres
```

### Run Database Migration

```bash
npm run prisma:migrate
```

### Generate Prisma Client

```bash
npm run prisma:generate
```

---

## Development

Run quality checks:

```bash
npm run lint
npm run format:check
npm test
```

---

## Roadmap

- Authentication
- Job Queue API
- Worker Service
- Retry System
- Dead Letter Queue
- Metrics Dashboard
- Docker Production Configuration

---

## License

Licensed under the MIT License.

See the [LICENSE](LICENSE) file for details.
