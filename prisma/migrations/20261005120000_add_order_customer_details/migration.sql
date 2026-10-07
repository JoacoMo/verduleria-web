-- Datos de contacto y entrega del pedido.
--
-- Hasta ahora el pedido quedaba guardado sin saber de quién era: si el cliente
-- no mandaba el WhatsApp, en el panel había un pedido huérfano. Ahora el checkout
-- pide nombre y teléfono (y dirección si es envío) y los guarda acá.
--
-- Todo nullable: los pedidos que ya existen no tienen estos datos.
ALTER TABLE "public"."Order" ADD COLUMN "customerAddress" TEXT;
ALTER TABLE "public"."Order" ADD COLUMN "notes" TEXT;
ALTER TABLE "public"."Order" ADD COLUMN "replacementPolicy" TEXT;
