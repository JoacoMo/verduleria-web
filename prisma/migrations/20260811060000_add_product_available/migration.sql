-- Disponibilidad de producto, controlada por el dueño desde el panel.
--
-- DEFAULT true para que los 54 productos que ya existen queden disponibles y
-- nada cambie al aplicar la migración. NOT NULL porque "no sé si hay stock" no
-- es un estado válido en esta app: o está o no está.
--
-- No se agrega índice a propósito: la tabla tiene decenas de filas y se lee
-- entera en cada carga, así que un índice sobre un boolean no aportaría nada
-- y solo encarecería las escrituras.
ALTER TABLE "public"."Product"
  ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true;
