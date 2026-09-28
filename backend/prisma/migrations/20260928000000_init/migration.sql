-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'BASE_COMMANDER', 'LOGISTICS_OFFICER');

-- CreateEnum
CREATE TYPE "StockKind" AS ENUM ('PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ASSIGN', 'RETURN', 'EXPEND');

-- CreateTable
CREATE TABLE "Base" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'units',

    CONSTRAINT "EquipmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "baseId" INTEGER,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" SERIAL NOT NULL,
    "baseId" INTEGER NOT NULL,
    "equipmentTypeId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "supplier" TEXT NOT NULL,
    "purchasedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Purchase_quantity_positive" CHECK ("quantity" > 0)
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" SERIAL NOT NULL,
    "fromBaseId" INTEGER NOT NULL,
    "toBaseId" INTEGER NOT NULL,
    "equipmentTypeId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "transferredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Transfer_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "Transfer_bases_different" CHECK ("fromBaseId" <> "toBaseId")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" SERIAL NOT NULL,
    "baseId" INTEGER NOT NULL,
    "equipmentTypeId" INTEGER NOT NULL,
    "personnel" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "expendedQuantity" INTEGER NOT NULL DEFAULT 0,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Assignment_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "Assignment_disposition_within_quantity" CHECK ("returnedQuantity" + "expendedQuantity" <= "quantity")
);

-- CreateTable
CREATE TABLE "StockEvent" (
    "id" SERIAL NOT NULL,
    "baseId" INTEGER NOT NULL,
    "equipmentTypeId" INTEGER NOT NULL,
    "kind" "StockKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER NOT NULL,

    CONSTRAINT "StockEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockEvent_quantity_positive" CHECK ("quantity" > 0)
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Base_name_key" ON "Base"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Base_code_key" ON "Base"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentType_name_key" ON "EquipmentType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Purchase_baseId_purchasedAt_idx" ON "Purchase"("baseId", "purchasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_reference_key" ON "Transfer"("reference");

-- CreateIndex
CREATE INDEX "Transfer_transferredAt_idx" ON "Transfer"("transferredAt");

-- CreateIndex
CREATE INDEX "Transfer_fromBaseId_transferredAt_idx" ON "Transfer"("fromBaseId", "transferredAt");

-- CreateIndex
CREATE INDEX "Transfer_toBaseId_transferredAt_idx" ON "Transfer"("toBaseId", "transferredAt");

-- CreateIndex
CREATE INDEX "Assignment_baseId_assignedAt_idx" ON "Assignment"("baseId", "assignedAt");

-- CreateIndex
CREATE INDEX "StockEvent_baseId_occurredAt_idx" ON "StockEvent"("baseId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockEvent_equipmentTypeId_occurredAt_idx" ON "StockEvent"("equipmentTypeId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "Base"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "Base"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_equipmentTypeId_fkey" FOREIGN KEY ("equipmentTypeId") REFERENCES "EquipmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromBaseId_fkey" FOREIGN KEY ("fromBaseId") REFERENCES "Base"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toBaseId_fkey" FOREIGN KEY ("toBaseId") REFERENCES "Base"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_equipmentTypeId_fkey" FOREIGN KEY ("equipmentTypeId") REFERENCES "EquipmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "Base"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_equipmentTypeId_fkey" FOREIGN KEY ("equipmentTypeId") REFERENCES "EquipmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEvent" ADD CONSTRAINT "StockEvent_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "Base"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEvent" ADD CONSTRAINT "StockEvent_equipmentTypeId_fkey" FOREIGN KEY ("equipmentTypeId") REFERENCES "EquipmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEvent" ADD CONSTRAINT "StockEvent_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
