import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { seedDemoData } from '../prisma/seed'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) throw new Error('Set TEST_DATABASE_URL to a dedicated PostgreSQL test database before running backend tests')
const testDatabaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '')
if (!testDatabaseName.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a dedicated database whose name ends in _test')

const database = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } })
const app = createApp(database)
let libertyId = 0
let pendletonId = 0
let vehicleId = 0
let radioId = 0

async function tokenFor(email: string, password: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password }).expect(200)
  return response.body.token as string
}

describe('Asset Command API', () => {
  beforeAll(async () => database.$connect())
  afterAll(async () => database.$disconnect())

  beforeEach(async () => {
    await seedDemoData(database, true)
    libertyId = (await database.base.findUniqueOrThrow({ where: { code: 'FLB' } })).id
    pendletonId = (await database.base.findUniqueOrThrow({ where: { code: 'CPB' } })).id
    vehicleId = (await database.equipmentType.findUniqueOrThrow({ where: { name: 'Utility Vehicle' } })).id
    radioId = (await database.equipmentType.findUniqueOrThrow({ where: { name: 'Field Radio' } })).id
  })

  it('requires valid authentication and rejects invalid credentials', async () => {
    await request(app).get('/api/auth/me').expect(401)
    await request(app).post('/api/auth/login').send({ email: 'admin@assetcommand.demo', password: 'wrong' }).expect(401)
    const token = await tokenFor('admin@assetcommand.demo', 'Admin123!')
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200)
  })

  it('enforces role access and commander base scope', async () => {
    const logisticsToken = await tokenFor('logistics@assetcommand.demo', 'Logistics123!')
    await request(app).get('/api/dashboard').set('Authorization', `Bearer ${logisticsToken}`).expect(403)
    await request(app).get('/api/assignments').set('Authorization', `Bearer ${logisticsToken}`).expect(403)
    await request(app).post('/api/purchases').set('Authorization', `Bearer ${logisticsToken}`).send({ baseId: libertyId, equipmentTypeId: radioId, quantity: 1, supplier: 'Allowed Supplier' }).expect(201)

    const commanderToken = await tokenFor('commander@assetcommand.demo', 'Commander123!')
    const dashboard = await request(app).get(`/api/dashboard?baseId=${pendletonId}`).set('Authorization', `Bearer ${commanderToken}`).expect(200)
    expect(dashboard.body.filters.baseId).toBe(libertyId)
    await request(app).post('/api/purchases').set('Authorization', `Bearer ${commanderToken}`).send({ baseId: pendletonId, equipmentTypeId: radioId, quantity: 1, supplier: 'Out of scope' }).expect(403)
  })

  it('calculates balances and movement for a filtered period', async () => {
    const token = await tokenFor('admin@assetcommand.demo', 'Admin123!')
    const response = await request(app).get('/api/dashboard?from=2026-09-01&to=2026-09-30').set('Authorization', `Bearer ${token}`).expect(200)
    expect(response.body).toMatchObject({ openingBalance: 494, closingBalance: 490, netMovement: 8, purchases: 8, transferIn: 3, transferOut: 3, assigned: 12, expended: 0 })
  })

  it('records purchases with a stock event and audit entry atomically', async () => {
    const token = await tokenFor('admin@assetcommand.demo', 'Admin123!')
    const created = await request(app).post('/api/purchases').set('Authorization', `Bearer ${token}`).send({ baseId: libertyId, equipmentTypeId: radioId, quantity: 4, supplier: 'Test Supplier' }).expect(201)
    expect(await database.purchase.count()).toBe(2)
    expect(await database.stockEvent.count({ where: { reference: `PUR-${created.body.id}`, kind: 'PURCHASE' } })).toBe(1)
    expect(await database.auditLog.count({ where: { entity: 'purchase', entityId: created.body.id } })).toBe(1)
    const history = await request(app).get(`/api/purchases?baseId=${libertyId}&equipmentId=${radioId}&from=2026-09-01&to=2026-09-30`).set('Authorization', `Bearer ${token}`).expect(200)
    expect(history.body).toHaveLength(2)
  })

  it('transfers stock between bases in one transaction and rejects overdraws', async () => {
    const token = await tokenFor('admin@assetcommand.demo', 'Admin123!')
    const result = await request(app).post('/api/transfers').set('Authorization', `Bearer ${token}`).send({ fromBaseId: libertyId, toBaseId: pendletonId, equipmentTypeId: vehicleId, quantity: 2 }).expect(201)
    expect(await database.stockEvent.count({ where: { reference: result.body.reference } })).toBe(2)
    expect(await database.auditLog.count({ where: { entity: 'transfer', entityId: result.body.id } })).toBe(1)
    const before = await database.transfer.count()
    await request(app).post('/api/transfers').set('Authorization', `Bearer ${token}`).send({ fromBaseId: libertyId, toBaseId: pendletonId, equipmentTypeId: vehicleId, quantity: 10000 }).expect(409)
    expect(await database.transfer.count()).toBe(before)
    const history = await request(app).get(`/api/transfers?baseId=${libertyId}`).set('Authorization', `Bearer ${token}`).expect(200)
    expect(history.body).toHaveLength(2)
  })

  it('tracks assignment, return, expenditure, and their audit records', async () => {
    const token = await tokenFor('admin@assetcommand.demo', 'Admin123!')
    const created = await request(app).post('/api/assignments').set('Authorization', `Bearer ${token}`).send({ baseId: libertyId, equipmentTypeId: radioId, personnel: 'Test Platoon', quantity: 3 }).expect(201)
    await request(app).post(`/api/assignments/${created.body.id}/return`).set('Authorization', `Bearer ${token}`).send({ quantity: 1 }).expect(200)
    await request(app).post(`/api/assignments/${created.body.id}/expense`).set('Authorization', `Bearer ${token}`).send({ quantity: 2 }).expect(200)
    await request(app).post(`/api/assignments/${created.body.id}/expense`).set('Authorization', `Bearer ${token}`).send({ quantity: 1 }).expect(409)
    const list = await request(app).get('/api/assignments?equipmentId=' + radioId).set('Authorization', `Bearer ${token}`).expect(200)
    expect(list.body.find((row: { id: number }) => row.id === created.body.id)).toMatchObject({ quantity: 3, returnedQuantity: 1, expendedQuantity: 2, activeQuantity: 0 })
    expect(await database.auditLog.count({ where: { entity: 'assignment', entityId: created.body.id } })).toBe(3)
    expect(await database.stockEvent.count({ where: { reference: `ASN-${created.body.id}` } })).toBe(3)
  })
})