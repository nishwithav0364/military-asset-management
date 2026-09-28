# Asset Command

Asset Command is a full-stack equipment logistics demo for tracking inventory, procurement, base-to-base transfers, personnel assignments, expenditure, and operator audit history. All included records and demo identities are fictional.

## Technology

- **Frontend:** React 19, TypeScript, Vite, Axios, and Lucide icons.
- **API:** Node.js 24, Express 5, JWT authentication, Zod validation, Helmet, and Morgan request logging.
- **Database:** SQLite via Node's built-in `node:sqlite` API. It provides relational tables, foreign keys, checks, and atomic write transactions without a separate local database service. The database file is created at `backend/data/assets.db` on first startup.

The embedded SQLite choice makes the take-home demo easy to run and inspect. For a hosted service, attach persistent storage to the API host or migrate the same relational model to PostgreSQL before using an ephemeral container. The built-in Node SQLite API is experimental in Node 24, so pin the runtime version for a deployment.

## Local Setup

Prerequisite: Node.js 24 or newer and npm.

In one terminal, configure and start the API:

```powershell
Copy-Item backend/.env.example backend/.env
npm --prefix backend install
npm --prefix backend run dev
```

In another terminal, start the frontend:

```powershell
Copy-Item frontend/.env.example frontend/.env
npm --prefix frontend install
npm --prefix frontend run dev
```

Open `http://localhost:5173`. The API health check is `http://localhost:4000/api/health`. The SQLite file and seed data persist across restarts. To reset the demo, stop the API and remove `backend/data/assets.db`; the next start creates and seeds a clean database.

The production frontend can be built with `npm --prefix frontend run build`; the API can be type-checked with `npm --prefix backend run build` and started with `npm --prefix backend start`.

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

Transfers write the transfer record, paired source/destination stock events, and audit entry in one SQLite transaction. Assignment, return, expenditure, and purchase writes also commit their ledger and audit records together. Foreign keys and quantity checks protect relational consistency.

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

The app is ready to run locally. Hosting links require external hosting/database accounts and environment variables; no credentials or hosted services are included in this workspace.