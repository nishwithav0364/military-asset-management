"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDemoData = seedDemoData;
const client_1 = require("@prisma/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
async function seedDemoData(database, reset = false) {
    if (reset) {
        await database.$transaction([
            database.auditLog.deleteMany(),
            database.stockEvent.deleteMany(),
            database.assignment.deleteMany(),
            database.transfer.deleteMany(),
            database.purchase.deleteMany(),
            database.user.deleteMany(),
            database.equipmentType.deleteMany(),
            database.base.deleteMany(),
        ]);
    }
    const liberty = await database.base.upsert({ where: { code: 'FLB' }, update: {}, create: { name: 'Fort Liberty', code: 'FLB' } });
    const pendleton = await database.base.upsert({ where: { code: 'CPB' }, update: {}, create: { name: 'Camp Pendleton', code: 'CPB' } });
    const vehicles = await database.equipmentType.upsert({ where: { name: 'Utility Vehicle' }, update: {}, create: { name: 'Utility Vehicle', category: 'Vehicles', unit: 'vehicles' } });
    const rifles = await database.equipmentType.upsert({ where: { name: 'Service Rifle' }, update: {}, create: { name: 'Service Rifle', category: 'Weapons', unit: 'weapons' } });
    const radios = await database.equipmentType.upsert({ where: { name: 'Field Radio' }, update: {}, create: { name: 'Field Radio', category: 'Communications', unit: 'radios' } });
    const credentials = [
        { name: 'System Administrator', email: 'admin@assetcommand.demo', password: 'Admin123!', role: client_1.Role.ADMIN, baseId: null },
        { name: 'Fort Liberty Commander', email: 'commander@assetcommand.demo', password: 'Commander123!', role: client_1.Role.BASE_COMMANDER, baseId: liberty.id },
        { name: 'Logistics Officer', email: 'logistics@assetcommand.demo', password: 'Logistics123!', role: client_1.Role.LOGISTICS_OFFICER, baseId: null },
    ];
    const users = await Promise.all(credentials.map(async (entry) => database.user.upsert({
        where: { email: entry.email }, update: { name: entry.name, role: entry.role, baseId: entry.baseId },
        create: { name: entry.name, email: entry.email, passwordHash: await bcrypt_1.default.hash(entry.password, 10), role: entry.role, baseId: entry.baseId },
    })));
    const [admin, commander, logistics] = users;
    if (!admin || !commander || !logistics)
        throw new Error('Could not seed demo users');
    const hasLedger = await database.stockEvent.count();
    if (hasLedger > 0)
        return;
    await database.$transaction(async (transaction) => {
        const openingDate = new Date('2026-01-01T08:00:00.000Z');
        const openingStock = [
            { baseId: liberty.id, equipmentTypeId: vehicles.id, quantity: 42 },
            { baseId: liberty.id, equipmentTypeId: rifles.id, quantity: 180 },
            { baseId: liberty.id, equipmentTypeId: radios.id, quantity: 64 },
            { baseId: pendleton.id, equipmentTypeId: vehicles.id, quantity: 31 },
            { baseId: pendleton.id, equipmentTypeId: rifles.id, quantity: 125 },
            { baseId: pendleton.id, equipmentTypeId: radios.id, quantity: 52 },
        ];
        await transaction.stockEvent.createMany({ data: openingStock.map((stock) => ({ ...stock, kind: client_1.StockKind.PURCHASE, reference: 'OPENING-BALANCE', occurredAt: openingDate, createdBy: admin.id })) });
        const purchase = await transaction.purchase.create({ data: { baseId: liberty.id, equipmentTypeId: radios.id, quantity: 8, supplier: 'Northstar Communications', purchasedAt: new Date('2026-09-18T10:30:00.000Z'), createdBy: logistics.id } });
        await transaction.stockEvent.create({ data: { baseId: liberty.id, equipmentTypeId: radios.id, kind: client_1.StockKind.PURCHASE, quantity: 8, reference: `PUR-${purchase.id}`, occurredAt: purchase.purchasedAt, createdBy: logistics.id } });
        await transaction.auditLog.create({ data: { actorId: logistics.id, action: 'PURCHASE_RECORDED', entity: 'purchase', entityId: purchase.id, details: { quantity: 8, supplier: 'Northstar Communications' }, createdAt: purchase.purchasedAt } });
        const transferDate = new Date('2026-09-20T14:10:00.000Z');
        const transfer = await transaction.transfer.create({ data: { fromBaseId: pendleton.id, toBaseId: liberty.id, equipmentTypeId: vehicles.id, quantity: 3, reference: 'TRF-2048', transferredAt: transferDate, createdBy: logistics.id } });
        await transaction.stockEvent.createMany({ data: [
                { baseId: pendleton.id, equipmentTypeId: vehicles.id, kind: client_1.StockKind.TRANSFER_OUT, quantity: 3, reference: transfer.reference, occurredAt: transferDate, createdBy: logistics.id },
                { baseId: liberty.id, equipmentTypeId: vehicles.id, kind: client_1.StockKind.TRANSFER_IN, quantity: 3, reference: transfer.reference, occurredAt: transferDate, createdBy: logistics.id },
            ] });
        await transaction.auditLog.create({ data: { actorId: logistics.id, action: 'TRANSFER_COMPLETED', entity: 'transfer', entityId: transfer.id, details: { quantity: 3, fromBaseId: pendleton.id, toBaseId: liberty.id }, createdAt: transferDate } });
        const assignmentDate = new Date('2026-09-22T09:00:00.000Z');
        const assignment = await transaction.assignment.create({ data: { baseId: liberty.id, equipmentTypeId: rifles.id, personnel: '1st Platoon', quantity: 12, assignedAt: assignmentDate, createdBy: commander.id } });
        await transaction.stockEvent.create({ data: { baseId: liberty.id, equipmentTypeId: rifles.id, kind: client_1.StockKind.ASSIGN, quantity: 12, reference: `ASN-${assignment.id}`, occurredAt: assignmentDate, createdBy: commander.id } });
        await transaction.auditLog.create({ data: { actorId: commander.id, action: 'ASSET_ASSIGNED', entity: 'assignment', entityId: assignment.id, details: { quantity: 12, personnel: '1st Platoon' }, createdAt: assignmentDate } });
    });
}
if (require.main === module) {
    const database = new client_1.PrismaClient();
    seedDemoData(database).then(() => console.log('Demo data ready')).finally(() => database.$disconnect());
}
