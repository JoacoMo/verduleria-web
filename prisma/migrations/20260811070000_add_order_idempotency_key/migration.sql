-- Clave de idempotencia para el checkout.
--
-- Problema que resuelve: cada POST a /api/checkout creaba un pedido nuevo. En el
-- celular, con conexión lenta, tocar "pagar" dos veces generaba dos pedidos (y dos
-- links de pago distintos). El dueño terminaba viendo pedidos duplicados.
--
-- El navegador manda una clave por intento de compra. Si ya hay un pedido con esa
-- clave, se devuelve ese mismo en vez de crear otro.
--
-- Nullable porque los 28 pedidos que ya existen no tienen clave. El índice UNIQUE
-- de Postgres permite múltiples NULL, así que no hay conflicto entre ellos.
-- El UNIQUE no es decorativo: es lo que corta la carrera cuando dos requests
-- llegan a la vez y ambos pasan la lectura previa.
ALTER TABLE "public"."Order" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "public"."Order"("idempotencyKey");
