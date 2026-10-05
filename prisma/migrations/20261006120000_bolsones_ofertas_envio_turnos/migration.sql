-- Bolsones y ofertas, envío con costo fijo, turnos de entrega y pago en efectivo.

-- Producto: descripción (qué trae un bolsón), precio de oferta con vencimiento y
-- fecha de última modificación (para el sitemap).
ALTER TABLE "public"."Product" ADD COLUMN "description" TEXT;
ALTER TABLE "public"."Product" ADD COLUMN "offerPrice" DOUBLE PRECISION;
ALTER TABLE "public"."Product" ADD COLUMN "offerEndsAt" TIMESTAMP(3);
ALTER TABLE "public"."Product" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Pedido: el envío pasa a ser parte del total.
ALTER TABLE "public"."Order" ADD COLUMN "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "public"."Order" ADD COLUMN "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "public"."Order" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "public"."Order" ADD COLUMN "deliverySlot" TEXT;
ALTER TABLE "public"."Order" ADD COLUMN "adjustedAt" TIMESTAMP(3);

-- Los pedidos que ya existen no tenían envío en el total: subtotal = total.
UPDATE "public"."Order" SET "subtotal" = "total";

-- Estado como enum: la base rechaza cualquier valor que no sea uno de estos
-- cuatro. El código nunca escribió otro, así que la conversión no falla.
CREATE TYPE "public"."OrderStatus" AS ENUM ('pending', 'paid', 'cancelled', 'failed');
ALTER TABLE "public"."Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."Order" ALTER COLUMN "status" TYPE "public"."OrderStatus" USING ("status"::"public"."OrderStatus");
ALTER TABLE "public"."Order" ALTER COLUMN "status" SET DEFAULT 'pending';

CREATE INDEX "Order_status_createdAt_idx" ON "public"."Order"("status", "createdAt");
