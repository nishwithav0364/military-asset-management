# Asset Command

Asset Command is a full-stack equipment logistics demo for tracking inventory, procurement, base-to-base transfers, personnel assignments, expenditure, and operator audit history. All included records and demo identities are fictional.

## Technology

- **Frontend:** React 19, TypeScript, Vite, Axios, and Lucide icons.
- **API:** Node.js 24, Express 5, JWT authentication, Zod validation, Helmet, and Morgan request logging.
- **Database:** PostgreSQL with Prisma ORM. PostgreSQL provides relational constraints, JSONB audit details, and atomic multi-record transactions; Prisma gives the app typed access and versioned migrations.

The same PostgreSQL schema is used in local development and production. Docker Compose provisions it locally; hosted deployments can use a managed PostgreSQL provider such as Neon.

## Local Setup

Prerequisites: Node.js 24 or newer, npm, and Docker Desktop with its engine running.

Start PostgreSQL and configure the API:

```powershell
docker compose up -d postgres
Copy-Item backend/.env.example backend/.env
npm --prefix backend install
npm --prefix backend run db:deploy
npm --prefix backend run db:seed
npm --prefix backend run dev
```

In another terminal, start the frontend:

```powershell
Copy-Item frontend/.env.example frontend/.env
npm --prefix frontend install
npm --prefix frontend run dev
```

Open `http://localhost:5173`. The API health check is `http://localhost:4000/api/health`. PostgreSQL data persists in the Docker volume `asset-command-postgres` across API restarts.

To reset local data, remove the Compose volume with `docker compose down -v`, then rerun the migration and seed commands. This permanently deletes the local database contents.

The production frontend can be built with `npm --prefix frontend run build`; the API can be built with `npm --prefix backend run build` and started with `npm --prefix backend start`.

## Demo Accounts

| Role | Email | Password | Access |
| --- | --- | --- | --- |
| Admin | `admin@assetcommand.demo` | `Admin123!` | All bases, all workflows, audit history |
| Base Commander | `commander@assetcommand.demo` | `Commander123!` | Fort Liberty dashboard and base-scoped operations |
| Logistics Officer | `logistics@assetcommand.demo` | `Logistics123!` | Purchases and transfers |

These credentials are for local demonstration only. Replace them and set a strong `JWT_SECRET` before deployment. The API refuses to start in production without `JWT_SECRET`.

## Inventory Accounting

The stock-event ledger is the source of truth. For each base and equipment type:

`Closing balance = opening balance + purchases + transfer in - transfer out - assignments + returns`

Assignments reduce available stock. A return restores available stock. Expenditure decreases the outstanding assigned quantity; it is reported separately and is not subtracted a second time from base stock. Net movement for the selected period follows the requested definition: `purchases + transfer in - transfer out`.

Transfers write the transfer record, paired source/destination stock events, and audit entry in one PostgreSQL transaction. Assignment, return, expenditure, and purchase writes also commit their ledger and audit records together. Foreign keys and quantity checks protect relational consistency.

## Data Model

- `bases` and `equipment_types` are reference tables.
- `users` has a role and optional assigned base.
- `purchases` records supplier, quantity, destination, operator, and timestamp.
- `transfers` records source, destination, equipment, quantity, unique reference, operator, and timestamp.
- `assignments` tracks issued quantity and returned/expended quantities.
- `stock_events` records each balance-affecting event with base, equipment, quantity, reference, timestamp, and operator.
- `audit_logs` stores the actor, action, entity, entity ID, transaction details, and timestamp.

## Access Control and Logging

Login returns an eight-hour signed JWT. Authentication middleware protects `/api` routes; role middleware gates operations, and service handlers enforce base ownership for commanders. A commander cannot select another base to read or mutate. Admin-only audit access is enforced by the API, not only the UI. Logistics officers can view and create purchases/transfers but cannot access dashboard or assignment routes.

Morgan logs HTTP requests. Every successful operational write creates an audit row in the same database transaction as the operational change, capturing the authenticated actor, operation, record ID, details, and server timestamp. Audit history is currently retained in the local database and the admin API returns the latest 100 entries.

## API Overview

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | Public | Sign in and receive JWT |
| `GET` | `/api/auth/me` | Authenticated | Current account and assigned base |
| `GET` | `/api/bases` | Authenticated | Base filter options |
| `GET` | `/api/equipment` | Authenticated | Equipment filter options |
| `GET` | `/api/dashboard` | Admin, commander | Balance metrics and equipment totals; accepts `baseId`, `equipmentId`, `from`, `to` |
| `GET`, `POST` | `/api/purchases` | Admin, commander, logistics | Purchase history and procurement |
| `GET`, `POST` | `/api/transfers` | Admin, commander, logistics | Transfer history and atomic transfer creation |
| `GET`, `POST` | `/api/assignments` | Admin, commander | Assignment history and asset issue |
| `POST` | `/api/assignments/:id/return` | Admin, commander | Record returned assigned assets |
| `POST` | `/api/assignments/:id/expense` | Admin, commander | Record expenditure against an assignment |
| `GET` | `/api/audit` | Admin | Recent audit entries |

List and dashboard endpoints accept applicable `baseId`, `equipmentId`, `from`, and `to` query filters. Requests use JSON and pass the token as `Authorization: Bearer <token>`.

## Demo Scope and Limitations

The seed contains two fictional bases and three equipment classes. A transfer supports one equipment type per transaction. Authentication has seeded accounts but no user administration, password reset, or token revocation UI. Audit listing is capped at 100 entries; larger deployments should add pagination, retention controls, backups, and monitoring. This is a take-home demonstration and must not contain real operational or sensitive military data.

## Automated Tests

Frontend tests run with Vitest, jsdom, and React Testing Library:

```powershell
npm --prefix frontend test
```

Backend Supertest tests require a **dedicated disposable PostgreSQL database**. Never set `TEST_DATABASE_URL` to a database containing data you need; the suite clears its test database before each case. With the Compose database running, create the test database and run:

```powershell
docker compose exec -T postgres createdb -U asset_command asset_command_test
$env:TEST_DATABASE_URL = "postgresql://asset_command:asset_command_dev@localhost:5433/asset_command_test?schema=public"
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm --prefix backend run db:deploy
npm --prefix backend test
```

The API tests cover authentication, RBAC, base scope, dashboard accounting, purchases, atomic transfers, assignments, returns, expenditure, and audit logs.

## SQLite Import

If an earlier SQLite demo database at `backend/data/assets.db` contains records you want to keep, point `DATABASE_URL` at an empty, migrated PostgreSQL database and run:

```powershell
npm --prefix backend run db:deploy
npm --prefix backend run db:import-sqlite
```

The importer preserves record IDs, password hashes, timestamps, ledger entries, and audit history. It refuses to import into a PostgreSQL database that already contains base records.

## Free Demo Deployment

- **Frontend:** Vercel Hobby; set the project root to `frontend` and `VITE_API_URL` to the Render API URL plus `/api`.
- **Backend:** Render Free Web Service; set build to `npm --prefix backend install && npm --prefix backend run build`, start to `npm --prefix backend start`, Node to 24, and health check to `/api/health`.
- **Database:** Neon Free PostgreSQL; set Render's `DATABASE_URL` to its connection string. No Render disk is needed after moving to PostgreSQL.
- Set `NODE_ENV=production`, a private random `JWT_SECRET`, `SEED_DEMO_DATA=true`, and `FRONTEND_ORIGIN` to the Vercel URL in Render.

Free services may sleep or scale to zero and have provider usage limits. Database persistence is separate from API availability; monitor the database provider's quotas and back up data you need to retain. Demo credentials are public by design and are only for synthetic take-home data.