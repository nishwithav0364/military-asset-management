import { Prisma, PrismaClient, Role, StockKind } from '@prisma/client'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import path from 'node:path'

type SourceRow = Record<string, string | number | null>

const sqlitePath = path.resolve(__dirname, '../data/assets.db')
const serialTables = ['Base', 'EquipmentType', 'User', 'Purchase', 'Transfer', 'Assignment', 'StockEvent', 'AuditLog']

function rows(connection: DatabaseSync, table: string) {
  return connection.prepare(`SELECT * FROM "${table}"`).all() as SourceRow[]
}

function requiredNumber(row: SourceRow, key: string) {
  const value = row[key]
  if (typeof value !== 'number') throw new Error(`Invalid SQLite value for ${key}`)
  return value
}

function requiredString(row: SourceRow, key: string) {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`Invalid SQLite value for ${key}`)
  return value
}

function optionalNumber(row: SourceRow, key: string) {
  const value = row[key]
  return typeof value === 'number' ? value : null
}

function requiredDate(row: SourceRow, key: string) {
  return new Date(requiredString(row, key))
}

function jsonValue(row: SourceRow, key: string): Prisma.InputJsonValue {
  const raw = row[key]
  if (typeof raw !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed === null ? {} : parsed as Prisma.InputJsonValue
  } catch {
    return { raw }
  }
}

async function main() {
  if (!existsSync(sqlitePath)) throw new Error(`SQLite database not found at ${sqlitePath}`)
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true })
  const database = new PrismaClient()
  try {
    const existingRows = await database.base.count()
    if (existingRows > 0) throw new Error('PostgreSQL already contains base records; refusing to import over existing data')

    const bases = rows(sqlite, 'bases')
    const equipmentTypes = rows(sqlite, 'equipment_types')
    const users = rows(sqlite, 'users')
    const purchases = rows(sqlite, 'purchases')
    const transfers = rows(sqlite, 'transfers')
    const assignments = rows(sqlite, 'assignments')
    const stockEvents = rows(sqlite, 'stock_events')
    const auditLogs = rows(sqlite, 'audit_logs')

    await database.$transaction(async (transaction) => {
      await transaction.base.createMany({ data: bases.map((row) => ({ id: requiredNumber(row, 'id'), name: requiredString(row, 'name'), code: requiredString(row, 'code') })) })
      await transaction.equipmentType.createMany({ data: equipmentTypes.map((row) => ({ id: requiredNumber(row, 'id'), name: requiredString(row, 'name'), category: requiredString(row, 'category'), unit: requiredString(row, 'unit') })) })
      await transaction.user.createMany({ data: users.map((row) => ({
        id: requiredNumber(row, 'id'), name: requiredString(row, 'name'), email: requiredString(row, 'email'), passwordHash: requiredString(row, 'password_hash'),
        role: requiredString(row, 'role') as Role, baseId: optionalNumber(row, 'base_id'),
      })) })
      await transaction.purchase.createMany({ data: purchases.map((row) => ({
        id: requiredNumber(row, 'id'), baseId: requiredNumber(row, 'base_id'), equipmentTypeId: requiredNumber(row, 'equipment_type_id'),
        quantity: requiredNumber(row, 'quantity'), supplier: requiredString(row, 'supplier'), purchasedAt: requiredDate(row, 'purchased_at'), createdBy: requiredNumber(row, 'created_by'),
      })) })
      await transaction.transfer.createMany({ data: transfers.map((row) => ({
        id: requiredNumber(row, 'id'), fromBaseId: requiredNumber(row, 'from_base_id'), toBaseId: requiredNumber(row, 'to_base_id'),
        equipmentTypeId: requiredNumber(row, 'equipment_type_id'), quantity: requiredNumber(row, 'quantity'), reference: requiredString(row, 'reference'),
        transferredAt: requiredDate(row, 'transferred_at'), createdBy: requiredNumber(row, 'created_by'),
      })) })
      await transaction.assignment.createMany({ data: assignments.map((row) => ({
        id: requiredNumber(row, 'id'), baseId: requiredNumber(row, 'base_id'), equipmentTypeId: requiredNumber(row, 'equipment_type_id'),
        personnel: requiredString(row, 'personnel'), quantity: requiredNumber(row, 'quantity'), returnedQuantity: requiredNumber(row, 'returned_quantity'),
        expendedQuantity: requiredNumber(row, 'expended_quantity'), assignedAt: requiredDate(row, 'assigned_at'), createdBy: requiredNumber(row, 'created_by'),
      })) })
      await transaction.stockEvent.createMany({ data: stockEvents.map((row) => ({
        id: requiredNumber(row, 'id'), baseId: requiredNumber(row, 'base_id'), equipmentTypeId: requiredNumber(row, 'equipment_type_id'),
        kind: requiredString(row, 'kind') as StockKind, quantity: requiredNumber(row, 'quantity'), reference: requiredString(row, 'reference'),
        occurredAt: requiredDate(row, 'occurred_at'), createdBy: requiredNumber(row, 'created_by'),
      })) })
      await transaction.auditLog.createMany({ data: auditLogs.map((row) => ({
        id: requiredNumber(row, 'id'), actorId: requiredNumber(row, 'actor_id'), action: requiredString(row, 'action'), entity: requiredString(row, 'entity'),
        entityId: requiredNumber(row, 'entity_id'), details: jsonValue(row, 'details'), createdAt: requiredDate(row, 'created_at'),
      })) })

      for (const table of serialTables) {
        await transaction.$queryRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX("id") FROM "${table}"), 1), EXISTS (SELECT 1 FROM "${table}"))`)
      }
    })
    console.log(`Imported ${bases.length} bases, ${equipmentTypes.length} equipment types, ${users.length} users, ${stockEvents.length} stock events, and ${auditLogs.length} audit entries.`)
  } finally {
    sqlite.close()
    await database.$disconnect()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})