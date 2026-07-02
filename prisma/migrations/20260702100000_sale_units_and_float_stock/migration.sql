-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "saleUnit" TEXT NOT NULL DEFAULT 'unit';

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "stock" TYPE DOUBLE PRECISION USING "stock"::double precision;