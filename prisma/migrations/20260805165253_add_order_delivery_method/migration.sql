-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryMethod" TEXT NOT NULL DEFAULT 'pickup';

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
