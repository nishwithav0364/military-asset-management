import { Prisma, PrismaClient, Role, StockKind } from '@prisma/client'
import bcrypt from 'bcrypt'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import morgan from 'morgan'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

type Claims = { id: number; name: string; email: string; role: Role; baseId: number | null }
type RequestWithUser = Request & { user?: Claims }
type DatabaseTransaction = Prisma.TransactionClient
type StockGroup = { kind: StockKind; _sum: { quantity: number | null } }
type StockReader = { stockEvent: PrismaClient['stockEvent'] }

const jwtSecret = process.env.JWT_SECRET ?? 'local-development-secret-change-me'
const filterSchema = z.object({
  baseId: z.coerce.number().int().positive().optional(),
  equipmentId: z.coerce.number().int().positive().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})
const loginSchema = z.object({ email: z.email(), password: z.string().min(1) })
const purchaseSchema = z.object({ baseId: z.number().int().positive(), equipmentTypeId: z.number().int().positive(), quantity: z.number().int().positive(), supplier: z.string().trim().min(2) })
const transferSchema = z.object({ fromBaseId: z.number().int().positive(), toBaseId: z.number().int().positive(), equipmentTypeId: z.number().int().positive(), quantity: z.number().int().positive() })
const assignmentSchema = z.object({ baseId: z.number().int().positive(), equipmentTypeId: z.number().int().positive(), personnel: z.string().trim().min(2), quantity: z.number().int().positive() })
const quantitySchema = z.object({ quantity: z.number().int().positive() })

function validateBody<T>(schema: z.ZodType<T>, request: Request, response: Response): T | null {
  const parsed = schema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
    return null
  }
  return parsed.data
}

function validateFilters(request: Request, response: Response) {
  const parsed = filterSchema.safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid filters' })
    return null
  }
  return parsed.data
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

function scopeBase(user: Claims, requestedBase?: number) {
  return user.role === Role.BASE_COMMANDER ? user.baseId : requestedBase ?? null
}

function dateBounds(filters: { from?: string; to?: string }) {
  return {
    gte: filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : undefined,
    lte: filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : undefined,
  }
}

function eventWhere(baseId: number | null, equipmentTypeId: number | undefined, occurredAt?: { lt?: Date; gte?: Date; lte?: Date }) {
  return { baseId: baseId ?? undefined, equipmentTypeId, occurredAt }
}

function signedBalance(groups: StockGroup[]) {
  return groups.reduce((total, group) => {
    const quantity = group._sum.quantity ?? 0
    if (group.kind === StockKind.PURCHASE || group.kind === StockKind.TRANSFER_IN || group.kind === StockKind.RETURN) return total + quantity
    if (group.kind === StockKind.TRANSFER_OUT || group.kind === StockKind.ASSIGN) return total - quantity
    return total
  }, 0)
}

async function stockGroups(client: PrismaClient | DatabaseTransaction, where: Prisma.StockEventWhereInput): Promise<StockGroup[]> {
  const reader = client as StockReader
  return reader.stockEvent.groupBy({ by: ['kind'], where, _sum: { quantity: true } }) as unknown as Promise<StockGroup[]>
}

async function currentStock(client: PrismaClient | DatabaseTransaction, baseId: number, equipmentTypeId: number) {
  return signedBalance(await stockGroups(client, { baseId, equipmentTypeId }))
}

async function createAudit(client: PrismaClient | DatabaseTransaction, actorId: number, action: string, entity: string, entityId: number, details: unknown) {
  await client.auditLog.create({ data: { actorId, action, entity, entityId, details: details as Prisma.InputJsonValue } })
}

async function lockBases(transaction: DatabaseTransaction, ids: number[]) {
  for (const id of [...new Set(ids)].sort((left, right) => left - right)) {
    await transaction.$queryRaw`SELECT "id" FROM "Base" WHERE "id" = ${id} FOR UPDATE`
  }
}

async function loadAssignmentForUpdate(transaction: DatabaseTransaction, id: number) {
  await transaction.$queryRaw`SELECT "id" FROM "Assignment" WHERE "id" = ${id} FOR UPDATE`
  return transaction.assignment.findUnique({ where: { id } })
}

function mapPurchase(row: Prisma.PurchaseGetPayload<{ include: { base: true; equipmentType: true; creator: true } }>) {
  return { id: row.id, quantity: row.quantity, supplier: row.supplier, date: row.purchasedAt, base: row.base.name, equipment: row.equipmentType.name, recorded_by: row.creator.name }
}

function mapTransfer(row: Prisma.TransferGetPayload<{ include: { source: true; destination: true; equipmentType: true; creator: true } }>) {
  return { id: row.id, reference: row.reference, quantity: row.quantity, date: row.transferredAt, from_base: row.source.name, to_base: row.destination.name, equipment: row.equipmentType.name, recorded_by: row.creator.name }
}

function mapAssignment(row: Prisma.AssignmentGetPayload<{ include: { base: true; equipmentType: true } }>) {
  return { id: row.id, personnel: row.personnel, quantity: row.quantity, returnedQuantity: row.returnedQuantity, expendedQuantity: row.expendedQuantity, activeQuantity: row.quantity - row.returnedQuantity - row.expendedQuantity, date: row.assignedAt, base: row.base.name, equipment: row.equipmentType.name }
}

export function createApp(database: PrismaClient) {
  const app = express()
  app.use(helmet())
  app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',') ?? true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(morgan('tiny'))

  app.get('/api/health', async (_request, response) => {
    await database.$queryRaw`SELECT 1`
    response.json({ status: 'ok', service: 'Asset Command API' })
  })

  app.post('/api/auth/login', async (request, response) => {
    const input = validateBody(loginSchema, request, response)
    if (!input) return
    const user = await database.user.findUnique({ where: { email: input.email.toLowerCase() }, include: { base: true } })
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) return response.status(401).json({ error: 'Email or password is incorrect' })
    const claims: Claims = { id: user.id, name: user.name, email: user.email, role: user.role, baseId: user.baseId }
    const token = jwt.sign(claims, jwtSecret, { expiresIn: '8h' })
    response.json({ token, user: { ...claims, baseName: user.base?.name ?? null } })
  })

  app.get('/api/auth/me', authenticate, async (request, response) => {
    const user = userFrom(request)
    const account = await database.user.findUnique({ where: { id: user.id }, include: { base: true } })
    if (!account) return response.status(401).json({ error: 'Account not found' })
    response.json({ ...user, baseName: account.base?.name ?? null })
  })

  app.use('/api', authenticate)

  app.get('/api/bases', async (_request, response) => {
    response.json(await database.base.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }))
  })

  app.get('/api/equipment', async (_request, response) => {
    response.json(await database.equipmentType.findMany({ select: { id: true, name: true, category: true, unit: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }))
  })

  app.get('/api/dashboard', allowRoles(Role.ADMIN, Role.BASE_COMMANDER), async (request, response) => {
    const filters = validateFilters(request, response)
    if (!filters) return
    const user = userFrom(request)
    const baseId = scopeBase(user, filters.baseId)
    const equipmentTypeId = filters.equipmentId
    const bounds = dateBounds(filters)
    const startDate = bounds.gte ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
    const endDate = bounds.lte ?? new Date()
    const [openingGroups, closingGroups, movementGroups, assignmentTotals, equipmentTypes] = await Promise.all([
      stockGroups(database, eventWhere(baseId, equipmentTypeId, { lt: startDate })),
      stockGroups(database, eventWhere(baseId, equipmentTypeId, { lte: endDate })),
      stockGroups(database, eventWhere(baseId, equipmentTypeId, { gte: bounds.gte ?? new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1)), lte: endDate })),
      database.assignment.aggregate({ where: { baseId: baseId ?? undefined, equipmentTypeId }, _sum: { quantity: true, returnedQuantity: true, expendedQuantity: true } }),
      database.equipmentType.findMany({ where: { id: equipmentTypeId }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
    ])
    const movement = Object.fromEntries(movementGroups.map((group) => [group.kind, group._sum.quantity ?? 0])) as Partial<Record<StockKind, number>>
    const byEquipment = equipmentTypes.map((item) => ({ id: item.id, name: item.name, category: item.category, unit: item.unit, balance: 0 }))
    const perEquipment = await (database as StockReader).stockEvent.groupBy({
      by: ['equipmentTypeId', 'kind'],
      where: eventWhere(baseId, equipmentTypeId, { lte: endDate }),
      _sum: { quantity: true },
    }) as unknown as (StockGroup & { equipmentTypeId: number })[]
    for (const item of byEquipment) {
      item.balance = signedBalance(perEquipment.filter((group) => group.equipmentTypeId === item.id))
    }
    const assigned = (assignmentTotals._sum.quantity ?? 0) - (assignmentTotals._sum.returnedQuantity ?? 0) - (assignmentTotals._sum.expendedQuantity ?? 0)
    response.json({
      openingBalance: signedBalance(openingGroups), closingBalance: signedBalance(closingGroups),
      netMovement: (movement[StockKind.PURCHASE] ?? 0) + (movement[StockKind.TRANSFER_IN] ?? 0) - (movement[StockKind.TRANSFER_OUT] ?? 0),
      purchases: movement[StockKind.PURCHASE] ?? 0, transferIn: movement[StockKind.TRANSFER_IN] ?? 0,
      transferOut: movement[StockKind.TRANSFER_OUT] ?? 0, assigned, expended: movement[StockKind.EXPEND] ?? 0,
      byEquipment, filters: { baseId, equipmentId: equipmentTypeId ?? null, from: bounds.gte?.toISOString().slice(0, 10) ?? startDate.toISOString().slice(0, 10), to: bounds.lte?.toISOString().slice(0, 10) ?? endDate.toISOString().slice(0, 10) },
    })
  })

  app.get('/api/purchases', allowRoles(Role.ADMIN, Role.BASE_COMMANDER, Role.LOGISTICS_OFFICER), async (request, response) => {
    const filters = validateFilters(request, response)
    if (!filters) return
    const baseId = scopeBase(userFrom(request), filters.baseId)
    const rows = await database.purchase.findMany({
      where: { baseId: baseId ?? undefined, equipmentTypeId: filters.equipmentId, purchasedAt: dateBounds(filters) },
      include: { base: true, equipmentType: true, creator: true }, orderBy: { purchasedAt: 'desc' },
    })
    response.json(rows.map(mapPurchase))
  })

  app.post('/api/purchases', allowRoles(Role.ADMIN, Role.BASE_COMMANDER, Role.LOGISTICS_OFFICER), async (request, response) => {
    const input = validateBody(purchaseSchema, request, response)
    if (!input) return
    const user = userFrom(request)
    if (user.role === Role.BASE_COMMANDER && user.baseId !== input.baseId) return response.status(403).json({ error: 'You can only record purchases for your assigned base' })
    const id = await database.$transaction(async (transaction) => {
      const purchase = await transaction.purchase.create({ data: { ...input, createdBy: user.id } })
      const reference = `PUR-${purchase.id}`
      await transaction.stockEvent.create({ data: { baseId: input.baseId, equipmentTypeId: input.equipmentTypeId, kind: StockKind.PURCHASE, quantity: input.quantity, reference, createdBy: user.id } })
      await createAudit(transaction, user.id, 'PURCHASE_RECORDED', 'purchase', purchase.id, input)
      return purchase.id
    })
    response.status(201).json({ id, message: 'Purchase recorded' })
  })

  app.get('/api/transfers', allowRoles(Role.ADMIN, Role.BASE_COMMANDER, Role.LOGISTICS_OFFICER), async (request, response) => {
    const filters = validateFilters(request, response)
    if (!filters) return
    const baseId = scopeBase(userFrom(request), filters.baseId)
    const conditions: Prisma.TransferWhereInput[] = []
    if (baseId) conditions.push({ OR: [{ fromBaseId: baseId }, { toBaseId: baseId }] })
    if (filters.equipmentId) conditions.push({ equipmentTypeId: filters.equipmentId })
    const bounds = dateBounds(filters)
    if (bounds.gte || bounds.lte) conditions.push({ transferredAt: bounds })
    const rows = await database.transfer.findMany({
      where: conditions.length ? { AND: conditions } : undefined,
      include: { source: true, destination: true, equipmentType: true, creator: true }, orderBy: { transferredAt: 'desc' },
    })
    response.json(rows.map(mapTransfer))
  })

  app.post('/api/transfers', allowRoles(Role.ADMIN, Role.BASE_COMMANDER, Role.LOGISTICS_OFFICER), async (request, response) => {
    const input = validateBody(transferSchema, request, response)
    if (!input) return
    const user = userFrom(request)
    if (input.fromBaseId === input.toBaseId) return response.status(400).json({ error: 'Source and destination bases must be different' })
    if (user.role === Role.BASE_COMMANDER && user.baseId !== input.fromBaseId && user.baseId !== input.toBaseId) return response.status(403).json({ error: 'A transfer must involve your assigned base' })
    const bases = await database.base.findMany({ where: { id: { in: [input.fromBaseId, input.toBaseId] } }, select: { id: true } })
    if (bases.length !== 2 || !await database.equipmentType.findUnique({ where: { id: input.equipmentTypeId }, select: { id: true } })) return response.status(400).json({ error: 'Choose valid bases and equipment type' })
    try {
      const result = await database.$transaction(async (transaction) => {
        await lockBases(transaction, [input.fromBaseId, input.toBaseId])
        if (await currentStock(transaction, input.fromBaseId, input.equipmentTypeId) < input.quantity) throw new Error('INSUFFICIENT_STOCK')
        const reference = `TRF-${randomUUID()}`
        const transfer = await transaction.transfer.create({ data: { ...input, reference, createdBy: user.id } })
        await transaction.stockEvent.createMany({ data: [
          { baseId: input.fromBaseId, equipmentTypeId: input.equipmentTypeId, kind: StockKind.TRANSFER_OUT, quantity: input.quantity, reference, createdBy: user.id },
          { baseId: input.toBaseId, equipmentTypeId: input.equipmentTypeId, kind: StockKind.TRANSFER_IN, quantity: input.quantity, reference, createdBy: user.id },
        ] })
        await createAudit(transaction, user.id, 'TRANSFER_COMPLETED', 'transfer', transfer.id, input)
        return { id: transfer.id, reference }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      response.status(201).json(result)
    } catch (error) {
      if (error instanceof Error && error.message === 'INSUFFICIENT_STOCK') return response.status(409).json({ error: 'Not enough available stock at the source base' })
      throw error
    }
  })

  app.get('/api/assignments', allowRoles(Role.ADMIN, Role.BASE_COMMANDER), async (request, response) => {
    const filters = validateFilters(request, response)
    if (!filters) return
    const baseId = scopeBase(userFrom(request), filters.baseId)
    const rows = await database.assignment.findMany({
      where: { baseId: baseId ?? undefined, equipmentTypeId: filters.equipmentId, assignedAt: dateBounds(filters) },
      include: { base: true, equipmentType: true }, orderBy: { assignedAt: 'desc' },
    })
    response.json(rows.map(mapAssignment))
  })

  app.post('/api/assignments', allowRoles(Role.ADMIN, Role.BASE_COMMANDER), async (request, response) => {
    const input = validateBody(assignmentSchema, request, response)
    if (!input) return
    const user = userFrom(request)
    if (user.role === Role.BASE_COMMANDER && user.baseId !== input.baseId) return response.status(403).json({ error: 'You can only assign assets at your base' })
    try {
      const id = await database.$transaction(async (transaction) => {
        await lockBases(transaction, [input.baseId])
        if (await currentStock(transaction, input.baseId, input.equipmentTypeId) < input.quantity) throw new Error('INSUFFICIENT_STOCK')
        const assignment = await transaction.assignment.create({ data: { ...input, createdBy: user.id } })
        const reference = `ASN-${assignment.id}`
        await transaction.stockEvent.create({ data: { baseId: input.baseId, equipmentTypeId: input.equipmentTypeId, kind: StockKind.ASSIGN, quantity: input.quantity, reference, createdBy: user.id } })
        await createAudit(transaction, user.id, 'ASSET_ASSIGNED', 'assignment', assignment.id, input)
        return assignment.id
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      response.status(201).json({ id, message: 'Assets assigned' })
    } catch (error) {
      if (error instanceof Error && error.message === 'INSUFFICIENT_STOCK') return response.status(409).json({ error: 'Not enough available stock to assign' })
      throw error
    }
  })

  async function updateAssignmentDisposition(request: Request, response: Response, kind: 'return' | 'expense') {
    const parsedId = z.coerce.number().int().positive().safeParse(request.params.id)
    const input = validateBody(quantitySchema, request, response)
    if (!parsedId.success || !input) return response.status(400).json({ error: 'Invalid assignment or quantity' })
    const user = userFrom(request)
    const assignmentId = parsedId.data
    const eventKind = kind === 'return' ? StockKind.RETURN : StockKind.EXPEND
    const auditAction = kind === 'return' ? 'ASSET_RETURNED' : 'ASSET_EXPENDED'
    const result = await database.$transaction(async (transaction) => {
      const assignment = await loadAssignmentForUpdate(transaction, assignmentId)
      if (!assignment) return { status: 404 as const, error: 'Assignment not found' }
      if (user.role === Role.BASE_COMMANDER && user.baseId !== assignment.baseId) return { status: 403 as const, error: 'This assignment belongs to another base' }
      if (assignment.quantity - assignment.returnedQuantity - assignment.expendedQuantity < input.quantity) return { status: 409 as const, error: kind === 'return' ? 'Return quantity exceeds the outstanding assignment' : 'Expenditure exceeds the outstanding assignment' }
      await transaction.assignment.update({ where: { id: assignmentId }, data: kind === 'return' ? { returnedQuantity: { increment: input.quantity } } : { expendedQuantity: { increment: input.quantity } } })
      await transaction.stockEvent.create({ data: { baseId: assignment.baseId, equipmentTypeId: assignment.equipmentTypeId, kind: eventKind, quantity: input.quantity, reference: `ASN-${assignmentId}`, createdBy: user.id } })
      await createAudit(transaction, user.id, auditAction, 'assignment', assignmentId, input)
      return { status: 200 as const, message: kind === 'return' ? 'Returned assets recorded' : 'Expended assets recorded' }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (result.status !== 200) return response.status(result.status).json({ error: result.error })
    response.json({ message: result.message })
  }

  app.post('/api/assignments/:id/return', allowRoles(Role.ADMIN, Role.BASE_COMMANDER), (request, response) => updateAssignmentDisposition(request, response, 'return'))
  app.post('/api/assignments/:id/expense', allowRoles(Role.ADMIN, Role.BASE_COMMANDER), (request, response) => updateAssignmentDisposition(request, response, 'expense'))

  app.get('/api/audit', allowRoles(Role.ADMIN), async (_request, response) => {
    const rows = await database.auditLog.findMany({ include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 })
    response.json(rows.map((row) => ({ id: row.id, action: row.action, entity: row.entity, entityId: row.entityId, details: JSON.stringify(row.details), date: row.createdAt, actor: row.actor.name })))
  })

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error)
    response.status(500).json({ error: 'Unexpected server error' })
  })

  return app
}