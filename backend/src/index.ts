import bcrypt from 'bcrypt'
import cors from 'cors'
import 'dotenv/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import morgan from 'morgan'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

type Role = 'ADMIN' | 'BASE_COMMANDER' | 'LOGISTICS_OFFICER'
type Claims = { id: number; name: string; email: string; role: Role; baseId: number | null }
type RequestWithUser = Request & { user?: Claims }

const app = express()
const port = Number(process.env.PORT ?? 4000)
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production')
const jwtSecret = process.env.JWT_SECRET ?? 'local-development-secret-change-me'
const dataDirectory = path.join(__dirname, '..', 'data')
mkdirSync(dataDirectory, { recursive: true })
const database = new DatabaseSync(path.join(dataDirectory, 'assets.db'))
database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
database.exec(`
  CREATE TABLE IF NOT EXISTS bases (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS equipment_types (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'units'
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ADMIN','BASE_COMMANDER','LOGISTICS_OFFICER')),
    base_id INTEGER REFERENCES bases(id)
  );
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY, base_id INTEGER NOT NULL REFERENCES bases(id), equipment_type_id INTEGER NOT NULL REFERENCES equipment_types(id),
    quantity INTEGER NOT NULL CHECK(quantity > 0), supplier TEXT NOT NULL, purchased_at TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY, from_base_id INTEGER NOT NULL REFERENCES bases(id), to_base_id INTEGER NOT NULL REFERENCES bases(id),
    equipment_type_id INTEGER NOT NULL REFERENCES equipment_types(id), quantity INTEGER NOT NULL CHECK(quantity > 0),
    reference TEXT NOT NULL UNIQUE, transferred_at TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id),
    CHECK(from_base_id <> to_base_id)
  );
  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY, base_id INTEGER NOT NULL REFERENCES bases(id), equipment_type_id INTEGER NOT NULL REFERENCES equipment_types(id),
    personnel TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), returned_quantity INTEGER NOT NULL DEFAULT 0,
    expended_quantity INTEGER NOT NULL DEFAULT 0, assigned_at TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id),
    CHECK(returned_quantity + expended_quantity <= quantity)
  );
  CREATE TABLE IF NOT EXISTS stock_events (
    id INTEGER PRIMARY KEY, base_id INTEGER NOT NULL REFERENCES bases(id), equipment_type_id INTEGER NOT NULL REFERENCES equipment_types(id),
    kind TEXT NOT NULL CHECK(kind IN ('PURCHASE','TRANSFER_IN','TRANSFER_OUT','ASSIGN','RETURN','EXPEND')),
    quantity INTEGER NOT NULL CHECK(quantity > 0), reference TEXT NOT NULL, occurred_at TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL,
    entity TEXT NOT NULL, entity_id INTEGER NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS stock_events_base_date ON stock_events(base_id, occurred_at);
  CREATE INDEX IF NOT EXISTS purchases_base_date ON purchases(base_id, purchased_at);
  CREATE INDEX IF NOT EXISTS transfers_date ON transfers(transferred_at);
  CREATE INDEX IF NOT EXISTS audit_logs_date ON audit_logs(created_at);
`)

function seedDatabase() {
  const baseCount = database.prepare('SELECT COUNT(*) AS count FROM bases').get() as { count: number }
  if (baseCount.count > 0) return

  database.exec('BEGIN')
  try {
    database.prepare('INSERT INTO bases (id, name, code) VALUES (?, ?, ?)').run(1, 'Fort Liberty', 'FLB')
    database.prepare('INSERT INTO bases (id, name, code) VALUES (?, ?, ?)').run(2, 'Camp Pendleton', 'CPB')
    const addEquipment = database.prepare('INSERT INTO equipment_types (id, name, category, unit) VALUES (?, ?, ?, ?)')
    addEquipment.run(1, 'Utility Vehicle', 'Vehicles', 'vehicles')
    addEquipment.run(2, 'Service Rifle', 'Weapons', 'weapons')
    addEquipment.run(3, 'Field Radio', 'Communications', 'radios')
    const adminPassword = bcrypt.hashSync('Admin123!', 10)
    const commanderPassword = bcrypt.hashSync('Commander123!', 10)
    const logisticsPassword = bcrypt.hashSync('Logistics123!', 10)
    const addUser = database.prepare('INSERT INTO users (id, name, email, password_hash, role, base_id) VALUES (?, ?, ?, ?, ?, ?)')
    addUser.run(1, 'System Administrator', 'admin@assetcommand.demo', adminPassword, 'ADMIN', null)
    addUser.run(2, 'Fort Liberty Commander', 'commander@assetcommand.demo', commanderPassword, 'BASE_COMMANDER', 1)
    addUser.run(3, 'Logistics Officer', 'logistics@assetcommand.demo', logisticsPassword, 'LOGISTICS_OFFICER', null)

    const initialStock = [
      [1, 1, 42], [1, 2, 180], [1, 3, 64], [2, 1, 31], [2, 2, 125], [2, 3, 52],
    ]
    const addEvent = database.prepare('INSERT INTO stock_events (base_id, equipment_type_id, kind, quantity, reference, occurred_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const [baseId, equipmentId, quantity] of initialStock) {
      addEvent.run(baseId, equipmentId, 'PURCHASE', quantity, 'OPENING-BALANCE', '2026-01-01T08:00:00.000Z', 1)
    }
    const addPurchase = database.prepare('INSERT INTO purchases (base_id, equipment_type_id, quantity, supplier, purchased_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    addPurchase.run(1, 3, 8, 'Northstar Communications', '2026-09-18T10:30:00.000Z', 3)
    addEvent.run(1, 3, 'PURCHASE', 8, 'PUR-1001', '2026-09-18T10:30:00.000Z', 3)
    const addTransfer = database.prepare('INSERT INTO transfers (id, from_base_id, to_base_id, equipment_type_id, quantity, reference, transferred_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    addTransfer.run(1, 2, 1, 1, 3, 'TRF-2048', '2026-09-20T14:10:00.000Z', 3)
    addEvent.run(2, 1, 'TRANSFER_IN', 3, 'TRF-2048', '2026-09-20T14:10:00.000Z', 3)
    addEvent.run(2, 1, 'TRANSFER_OUT', 3, 'TRF-2048', '2026-09-20T14:10:00.000Z', 3)
    database.prepare('INSERT INTO assignments (id, base_id, equipment_type_id, personnel, quantity, assigned_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(1, 1, 2, '1st Platoon', 12, '2026-09-22T09:00:00.000Z', 2)
    addEvent.run(1, 1, 'ASSIGN', 12, 'ASN-3001', '2026-09-22T09:00:00.000Z', 2)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
seedDatabase()

app.use(helmet())
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',') ?? true }))
app.use(express.json({ limit: '1mb' }))
app.use(morgan('tiny'))

function transaction<T>(callback: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function audit(actorId: number, action: string, entity: string, entityId: number, details: unknown) {
  database.prepare('INSERT INTO audit_logs (actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(actorId, action, entity, entityId, JSON.stringify(details), new Date().toISOString())
}

function authenticate(request: Request, response: Response, next: NextFunction) {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return response.status(401).json({ error: 'Authentication required' })
  try {
    ;(request as RequestWithUser).user = jwt.verify(token, jwtSecret) as Claims
    next()
  } catch {
    response.status(401).json({ error: 'Session expired. Please sign in again.' })
  }
}

function allowRoles(...roles: Role[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const user = (request as RequestWithUser).user
    if (!user || !roles.includes(user.role)) return response.status(403).json({ error: 'You do not have permission for this operation' })
    next()
  }
}

function userFrom(request: Request) {
  return (request as RequestWithUser).user!
}

function parseId(value: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function scopeBase(user: Claims, requestedBase?: string | null) {
  if (user.role === 'BASE_COMMANDER') return user.baseId
  return requestedBase && parseId(requestedBase) ? parseId(requestedBase) : null
}

function validateBody<T>(schema: z.ZodType<T>, request: Request, response: Response): T | null {
  const parsed = schema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
    return null
  }
  return parsed.data
}

function recordStock(baseId: number, equipmentTypeId: number, kind: string, quantity: number, reference: string, actorId: number) {
  database.prepare('INSERT INTO stock_events (base_id, equipment_type_id, kind, quantity, reference, occurred_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(baseId, equipmentTypeId, kind, quantity, reference, new Date().toISOString(), actorId)
}

function currentStock(baseId: number, equipmentTypeId: number) {
  const row = database.prepare(`SELECT COALESCE(SUM(CASE
    WHEN kind IN ('PURCHASE','TRANSFER_IN','RETURN') THEN quantity
    WHEN kind IN ('TRANSFER_OUT','ASSIGN') THEN -quantity
    ELSE 0 END), 0) AS quantity
    FROM stock_events WHERE base_id = ? AND equipment_type_id = ?`).get(baseId, equipmentTypeId) as { quantity: number }
  return row.quantity
}

app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'Asset Command API' }))

app.post('/api/auth/login', (request, response) => {
  const input = validateBody(z.object({ email: z.string().email(), password: z.string().min(1) }), request, response)
  if (!input) return
  const user = database.prepare(`SELECT users.id, users.name, users.email, users.password_hash, users.role, users.base_id,
      bases.name AS base_name FROM users LEFT JOIN bases ON bases.id = users.base_id WHERE users.email = ?`)
    .get(input.email.toLowerCase()) as (Omit<Claims, 'baseId'> & { base_id: number | null; password_hash: string; base_name: string | null }) | undefined
  if (!user || !bcrypt.compareSync(input.password, user.password_hash)) return response.status(401).json({ error: 'Email or password is incorrect' })
  const claims: Claims = { id: user.id, name: user.name, email: user.email, role: user.role, baseId: user.base_id }
  const token = jwt.sign(claims, jwtSecret, { expiresIn: '8h' })
  response.json({ token, user: { ...claims, baseName: user.base_name } })
})

app.get('/api/auth/me', authenticate, (request, response) => {
  const user = userFrom(request)
  const base = user.baseId ? database.prepare('SELECT name FROM bases WHERE id = ?').get(user.baseId) as { name: string } | undefined : undefined
  response.json({ ...user, baseName: base?.name ?? null })
})

app.use('/api', authenticate)

app.get('/api/bases', (_request, response) => {
  response.json(database.prepare('SELECT id, name, code FROM bases ORDER BY name').all())
})

app.get('/api/equipment', (_request, response) => {
  response.json(database.prepare('SELECT id, name, category, unit FROM equipment_types ORDER BY name').all())
})

app.get('/api/dashboard', allowRoles('ADMIN', 'BASE_COMMANDER'), (request, response) => {
  const user = userFrom(request)
  const query = request.query as Record<string, string | undefined>
  const baseId = scopeBase(user, query.baseId)
  const equipmentId = query.equipmentId && parseId(query.equipmentId) ? parseId(query.equipmentId) : null
  const startDate = query.from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  const endDate = query.to ?? new Date().toISOString().slice(0, 10)
  const where = [baseId ? 'base_id = ?' : '', equipmentId ? 'equipment_type_id = ?' : ''].filter(Boolean).join(' AND ')
  const args = [baseId, equipmentId].filter((value): value is number => value !== null)
  const stockWhere = where ? ` AND ${where}` : ''
  const before = database.prepare(`SELECT COALESCE(SUM(CASE WHEN kind IN ('PURCHASE','TRANSFER_IN','RETURN') THEN quantity WHEN kind IN ('TRANSFER_OUT','ASSIGN') THEN -quantity ELSE 0 END), 0) AS total FROM stock_events WHERE occurred_at < ?${stockWhere}`)
    .get(`${startDate}T00:00:00.000Z`, ...args) as { total: number }
  const closing = database.prepare(`SELECT COALESCE(SUM(CASE WHEN kind IN ('PURCHASE','TRANSFER_IN','RETURN') THEN quantity WHEN kind IN ('TRANSFER_OUT','ASSIGN') THEN -quantity ELSE 0 END), 0) AS total FROM stock_events WHERE occurred_at < ?${stockWhere}`)
    .get(`${endDate}T23:59:59.999Z`, ...args) as { total: number }
  const movements = database.prepare(`SELECT kind, COALESCE(SUM(quantity), 0) AS quantity FROM stock_events WHERE occurred_at >= ? AND occurred_at <= ?${stockWhere} GROUP BY kind`)
    .all(`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`, ...args) as { kind: string; quantity: number }[]
  const values = Object.fromEntries(movements.map((row) => [row.kind, row.quantity])) as Record<string, number>
  const activeAssignments = database.prepare(`SELECT COALESCE(SUM(quantity - returned_quantity - expended_quantity), 0) AS quantity FROM assignments WHERE 1 = 1${baseId ? ' AND base_id = ?' : ''}${equipmentId ? ' AND equipment_type_id = ?' : ''}`)
    .get(...args) as { quantity: number }
  const summary = { openingBalance: before.total, closingBalance: closing.total,
    netMovement: (values.PURCHASE ?? 0) + (values.TRANSFER_IN ?? 0) - (values.TRANSFER_OUT ?? 0),
    purchases: values.PURCHASE ?? 0, transferIn: values.TRANSFER_IN ?? 0, transferOut: values.TRANSFER_OUT ?? 0,
    assigned: activeAssignments.quantity, expended: values.EXPEND ?? 0 }
  const byEquipment = database.prepare(`SELECT equipment_types.id, equipment_types.name, equipment_types.category, equipment_types.unit,
      COALESCE(SUM(CASE WHEN stock_events.kind IN ('PURCHASE','TRANSFER_IN','RETURN') THEN stock_events.quantity WHEN stock_events.kind IN ('TRANSFER_OUT','ASSIGN') THEN -stock_events.quantity ELSE 0 END), 0) AS balance
      FROM equipment_types LEFT JOIN stock_events ON stock_events.equipment_type_id = equipment_types.id AND stock_events.occurred_at <= ?${baseId ? ' AND stock_events.base_id = ?' : ''}
      ${equipmentId ? 'WHERE equipment_types.id = ?' : ''} GROUP BY equipment_types.id ORDER BY equipment_types.category, equipment_types.name`)
    .all(`${endDate}T23:59:59.999Z`, ...(baseId ? [baseId] : []), ...(equipmentId ? [equipmentId] : []))
  response.json({ ...summary, byEquipment, filters: { baseId, equipmentId, from: startDate, to: endDate } })
})

app.get('/api/purchases', allowRoles('ADMIN', 'BASE_COMMANDER', 'LOGISTICS_OFFICER'), (request, response) => {
  const user = userFrom(request)
  const query = request.query as Record<string, string | undefined>
  const baseId = scopeBase(user, query.baseId)
  const filters: string[] = []
  const args: (string | number)[] = []
  if (baseId) { filters.push('purchases.base_id = ?'); args.push(baseId) }
  if (query.equipmentId && parseId(query.equipmentId)) { filters.push('purchases.equipment_type_id = ?'); args.push(parseId(query.equipmentId)!) }
  if (query.from) { filters.push('date(purchases.purchased_at) >= date(?)'); args.push(query.from) }
  if (query.to) { filters.push('date(purchases.purchased_at) <= date(?)'); args.push(query.to) }
  const rows = database.prepare(`SELECT purchases.id, purchases.quantity, purchases.supplier, purchases.purchased_at AS date,
      bases.name AS base, equipment_types.name AS equipment, users.name AS recorded_by
      FROM purchases JOIN bases ON bases.id = purchases.base_id JOIN equipment_types ON equipment_types.id = purchases.equipment_type_id
      JOIN users ON users.id = purchases.created_by ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY purchases.purchased_at DESC`)
    .all(...args)
  response.json(rows)
})

app.post('/api/purchases', allowRoles('ADMIN', 'BASE_COMMANDER', 'LOGISTICS_OFFICER'), (request, response) => {
  const input = validateBody(z.object({ baseId: z.number().int().positive(), equipmentTypeId: z.number().int().positive(), quantity: z.number().int().positive(), supplier: z.string().trim().min(2) }), request, response)
  if (!input) return
  const user = userFrom(request)
  if (user.role === 'BASE_COMMANDER' && user.baseId !== input.baseId) return response.status(403).json({ error: 'You can only record purchases for your assigned base' })
  const equipment = database.prepare('SELECT id FROM equipment_types WHERE id = ?').get(input.equipmentTypeId)
  if (!equipment || !database.prepare('SELECT id FROM bases WHERE id = ?').get(input.baseId)) return response.status(400).json({ error: 'Choose a valid base and equipment type' })
  const id = transaction(() => {
    const result = database.prepare('INSERT INTO purchases (base_id, equipment_type_id, quantity, supplier, purchased_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.baseId, input.equipmentTypeId, input.quantity, input.supplier, new Date().toISOString(), user.id)
    recordStock(input.baseId, input.equipmentTypeId, 'PURCHASE', input.quantity, `PUR-${result.lastInsertRowid}`, user.id)
    audit(user.id, 'PURCHASE_RECORDED', 'purchase', Number(result.lastInsertRowid), input)
    return Number(result.lastInsertRowid)
  })
  response.status(201).json({ id, message: 'Purchase recorded' })
})

app.get('/api/transfers', allowRoles('ADMIN', 'BASE_COMMANDER', 'LOGISTICS_OFFICER'), (request, response) => {
  const user = userFrom(request)
  const baseId = scopeBase(user, (request.query.baseId as string | undefined) ?? null)
  const query = request.query as Record<string, string | undefined>
  const filters: string[] = []
  const args: (string | number)[] = []
  if (baseId) { filters.push('(transfers.from_base_id = ? OR transfers.to_base_id = ?)'); args.push(baseId, baseId) }
  if (query.equipmentId && parseId(query.equipmentId)) { filters.push('transfers.equipment_type_id = ?'); args.push(parseId(query.equipmentId)!) }
  if (query.from) { filters.push('date(transfers.transferred_at) >= date(?)'); args.push(query.from) }
  if (query.to) { filters.push('date(transfers.transferred_at) <= date(?)'); args.push(query.to) }
  const rows = database.prepare(`SELECT transfers.id, transfers.reference, transfers.quantity, transfers.transferred_at AS date,
      source.name AS from_base, destination.name AS to_base, equipment_types.name AS equipment, users.name AS recorded_by
      FROM transfers JOIN bases source ON source.id = transfers.from_base_id JOIN bases destination ON destination.id = transfers.to_base_id
      JOIN equipment_types ON equipment_types.id = transfers.equipment_type_id JOIN users ON users.id = transfers.created_by
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY transfers.transferred_at DESC`).all(...args)
  response.json(rows)
})

app.post('/api/transfers', allowRoles('ADMIN', 'BASE_COMMANDER', 'LOGISTICS_OFFICER'), (request, response) => {
  const input = validateBody(z.object({ fromBaseId: z.number().int().positive(), toBaseId: z.number().int().positive(), equipmentTypeId: z.number().int().positive(), quantity: z.number().int().positive() }), request, response)
  if (!input) return
  const user = userFrom(request)
  if (input.fromBaseId === input.toBaseId) return response.status(400).json({ error: 'Source and destination bases must be different' })
  if (user.role === 'BASE_COMMANDER' && user.baseId !== input.fromBaseId && user.baseId !== input.toBaseId) return response.status(403).json({ error: 'A transfer must involve your assigned base' })
  if (database.prepare('SELECT id FROM bases WHERE id IN (?, ?)').all(input.fromBaseId, input.toBaseId).length !== 2 || !database.prepare('SELECT id FROM equipment_types WHERE id = ?').get(input.equipmentTypeId)) return response.status(400).json({ error: 'Choose valid bases and equipment type' })
  let result: { id: number; reference: string }
  try {
    result = transaction(() => {
      if (currentStock(input.fromBaseId, input.equipmentTypeId) < input.quantity) throw new Error('INSUFFICIENT_STOCK')
      const reference = `TRF-${randomUUID()}`
      const transfer = database.prepare('INSERT INTO transfers (from_base_id, to_base_id, equipment_type_id, quantity, reference, transferred_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(input.fromBaseId, input.toBaseId, input.equipmentTypeId, input.quantity, reference, new Date().toISOString(), user.id)
      recordStock(input.fromBaseId, input.equipmentTypeId, 'TRANSFER_OUT', input.quantity, reference, user.id)
      recordStock(input.toBaseId, input.equipmentTypeId, 'TRANSFER_IN', input.quantity, reference, user.id)
      audit(user.id, 'TRANSFER_COMPLETED', 'transfer', Number(transfer.lastInsertRowid), input)
      return { id: Number(transfer.lastInsertRowid), reference }
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_STOCK') return response.status(409).json({ error: 'Not enough available stock at the source base' })
    throw error
  }
  response.status(201).json(result)
})

app.get('/api/assignments', allowRoles('ADMIN', 'BASE_COMMANDER'), (request, response) => {
  const user = userFrom(request)
  const query = request.query as Record<string, string | undefined>
  const baseId = scopeBase(user, query.baseId)
  const filters: string[] = []
  const args: (string | number)[] = []
  if (baseId) { filters.push('assignments.base_id = ?'); args.push(baseId) }
  if (query.equipmentId && parseId(query.equipmentId)) { filters.push('assignments.equipment_type_id = ?'); args.push(parseId(query.equipmentId)!) }
  if (query.from) { filters.push('date(assignments.assigned_at) >= date(?)'); args.push(query.from) }
  if (query.to) { filters.push('date(assignments.assigned_at) <= date(?)'); args.push(query.to) }
  const rows = database.prepare(`SELECT assignments.id, assignments.personnel, assignments.quantity,
      assignments.returned_quantity AS returnedQuantity, assignments.expended_quantity AS expendedQuantity,
      assignments.quantity - assignments.returned_quantity - assignments.expended_quantity AS activeQuantity,
      assignments.assigned_at AS date, bases.name AS base, equipment_types.name AS equipment
      FROM assignments JOIN bases ON bases.id = assignments.base_id JOIN equipment_types ON equipment_types.id = assignments.equipment_type_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY assignments.assigned_at DESC`).all(...args)
  response.json(rows)
})

app.post('/api/assignments', allowRoles('ADMIN', 'BASE_COMMANDER'), (request, response) => {
  const input = validateBody(z.object({ baseId: z.number().int().positive(), equipmentTypeId: z.number().int().positive(), personnel: z.string().trim().min(2), quantity: z.number().int().positive() }), request, response)
  if (!input) return
  const user = userFrom(request)
  if (user.role === 'BASE_COMMANDER' && user.baseId !== input.baseId) return response.status(403).json({ error: 'You can only assign assets at your base' })
  if (!database.prepare('SELECT id FROM bases WHERE id = ?').get(input.baseId) || !database.prepare('SELECT id FROM equipment_types WHERE id = ?').get(input.equipmentTypeId)) return response.status(400).json({ error: 'Choose a valid base and equipment type' })
  let assignmentId: number
  try {
    assignmentId = transaction(() => {
      if (currentStock(input.baseId, input.equipmentTypeId) < input.quantity) throw new Error('INSUFFICIENT_STOCK')
      const result = database.prepare('INSERT INTO assignments (base_id, equipment_type_id, personnel, quantity, assigned_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.baseId, input.equipmentTypeId, input.personnel, input.quantity, new Date().toISOString(), user.id)
      const id = Number(result.lastInsertRowid)
      recordStock(input.baseId, input.equipmentTypeId, 'ASSIGN', input.quantity, `ASN-${id}`, user.id)
      audit(user.id, 'ASSET_ASSIGNED', 'assignment', id, input)
      return id
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_STOCK') return response.status(409).json({ error: 'Not enough available stock to assign' })
    throw error
  }
  response.status(201).json({ id: assignmentId, message: 'Assets assigned' })
})

app.post('/api/assignments/:id/return', allowRoles('ADMIN', 'BASE_COMMANDER'), (request, response) => {
  const assignmentId = parseId(Array.isArray(request.params.id) ? request.params.id[0] ?? '' : request.params.id)
  const input = validateBody(z.object({ quantity: z.number().int().positive() }), request, response)
  if (!assignmentId || !input) return response.status(400).json({ error: 'Invalid assignment or quantity' })
  const user = userFrom(request)
  const assignment = database.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as { base_id: number; equipment_type_id: number; quantity: number; returned_quantity: number; expended_quantity: number } | undefined
  if (!assignment) return response.status(404).json({ error: 'Assignment not found' })
  if (user.role === 'BASE_COMMANDER' && user.baseId !== assignment.base_id) return response.status(403).json({ error: 'This assignment belongs to another base' })
  if (assignment.quantity - assignment.returned_quantity - assignment.expended_quantity < input.quantity) return response.status(409).json({ error: 'Return quantity exceeds the outstanding assignment' })
  transaction(() => {
    database.prepare('UPDATE assignments SET returned_quantity = returned_quantity + ? WHERE id = ?').run(input.quantity, assignmentId)
    recordStock(assignment.base_id, assignment.equipment_type_id, 'RETURN', input.quantity, `ASN-${assignmentId}`, user.id)
    audit(user.id, 'ASSET_RETURNED', 'assignment', assignmentId, input)
  })
  response.json({ message: 'Returned assets recorded' })
})

app.post('/api/assignments/:id/expense', allowRoles('ADMIN', 'BASE_COMMANDER'), (request, response) => {
  const assignmentId = parseId(Array.isArray(request.params.id) ? request.params.id[0] ?? '' : request.params.id)
  const input = validateBody(z.object({ quantity: z.number().int().positive() }), request, response)
  if (!assignmentId || !input) return response.status(400).json({ error: 'Invalid assignment or quantity' })
  const user = userFrom(request)
  const assignment = database.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as { base_id: number; equipment_type_id: number; quantity: number; returned_quantity: number; expended_quantity: number } | undefined
  if (!assignment) return response.status(404).json({ error: 'Assignment not found' })
  if (user.role === 'BASE_COMMANDER' && user.baseId !== assignment.base_id) return response.status(403).json({ error: 'This assignment belongs to another base' })
  if (assignment.quantity - assignment.returned_quantity - assignment.expended_quantity < input.quantity) return response.status(409).json({ error: 'Expenditure exceeds the outstanding assignment' })
  transaction(() => {
    database.prepare('UPDATE assignments SET expended_quantity = expended_quantity + ? WHERE id = ?').run(input.quantity, assignmentId)
    recordStock(assignment.base_id, assignment.equipment_type_id, 'EXPEND', input.quantity, `ASN-${assignmentId}`, user.id)
    audit(user.id, 'ASSET_EXPENDED', 'assignment', assignmentId, input)
  })
  response.json({ message: 'Expended assets recorded' })
})

app.get('/api/audit', allowRoles('ADMIN'), (_request, response) => {
  response.json(database.prepare(`SELECT audit_logs.id, audit_logs.action, audit_logs.entity, audit_logs.entity_id AS entityId,
      audit_logs.details, audit_logs.created_at AS date, users.name AS actor
      FROM audit_logs JOIN users ON users.id = audit_logs.actor_id ORDER BY audit_logs.created_at DESC LIMIT 100`).all())
})

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error)
  response.status(500).json({ error: 'Unexpected server error' })
})

app.listen(port, () => console.log(`Asset Command API listening on http://localhost:${port}`))