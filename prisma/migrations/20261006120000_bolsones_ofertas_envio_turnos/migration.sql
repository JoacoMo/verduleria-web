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

-- Estado: integridad en la base con una restricción CHECK y no con un enum.
--
-- Un enum cambia el tipo de la columna: el código que está en producción (que
-- lee y escribe "status" como texto) fallaba con "Error converting field
-- status" desde el momento en que se aplicaba la migración hasta que terminaba
-- el deploy. El CHECK da la misma garantía (la base rechaza cualquier otro
-- valor) sin cambiar el tipo, así que es compatible con las dos versiones.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."Order"
    WHERE "status" NOT IN ('pending', 'paid', 'cancelled', 'failed')
  ) THEN
    RAISE EXCEPTION 'Hay pedidos con un estado distinto de pending/paid/cancelled/failed: corregilos antes de migrar.';
  END IF;
END $$;

ALTER TABLE "public"."Order"
  ADD CONSTRAINT "Order_status_check" CHECK ("status" IN ('pending', 'paid', 'cancelled', 'failed'));

-- Índices para las consultas nuevas: limpieza diaria, pedidos por turno en el
-- panel y tope de pedidos por teléfono en el checkout.
CREATE INDEX "Order_status_createdAt_idx" ON "public"."Order"("status", "createdAt");
CREATE INDEX "Order_status_updatedAt_idx" ON "public"."Order"("status", "updatedAt");
CREATE INDEX "Order_deliverySlot_idx" ON "public"."Order"("deliverySlot");
CREATE INDEX "Order_customerPhone_createdAt_idx" ON "public"."Order"("customerPhone", "createdAt");
