-- Comprobación del esquema después de `prisma migrate deploy` en el build de
-- producción (scripts/migrate-on-production.mjs). No cambia nada: si falta algo
-- de lo que usa el código, corta con un error que dice qué es.
--
-- `migrate deploy` solo mira qué migraciones figuran aplicadas, no su contenido:
-- si una se aplicó a mano con una versión distinta (por ejemplo, la que creaba
-- "status" como enum), diría "No pending migrations" y el código nuevo daría 500.
--
-- Al agregar una migración que el código necesite, sumá acá lo que agrega.
DO $$
DECLARE
  faltantes text[] := ARRAY[]::text[];
  esperado text;
  tipo_estado text;
BEGIN
  FOREACH esperado IN ARRAY ARRAY[
    'Product.description', 'Product.offerPrice', 'Product.offerEndsAt', 'Product.updatedAt',
    'Product.available', 'Product.category',
    'Order.subtotal', 'Order.shippingCost', 'Order.paymentMethod', 'Order.deliverySlot',
    'Order.adjustedAt', 'Order.customerAddress', 'Order.notes', 'Order.replacementPolicy',
    'Order.idempotencyKey', 'Order.deliveryMethod'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = split_part(esperado, '.', 1)
        AND column_name = split_part(esperado, '.', 2)
    ) THEN
      faltantes := faltantes || ('columna ' || esperado);
    END IF;
  END LOOP;

  SELECT data_type INTO tipo_estado FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Order' AND column_name = 'status';
  IF tipo_estado IS DISTINCT FROM 'text' THEN
    faltantes := faltantes || ('Order.status es ' || coalesce(tipo_estado, '(no existe)') || ' y tiene que ser text');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Order_status_check' AND conrelid = '"public"."Order"'::regclass
  ) THEN
    faltantes := faltantes || 'restricción Order_status_check'::text;
  END IF;

  FOREACH esperado IN ARRAY ARRAY[
    'Order_idempotencyKey_key', 'Order_status_createdAt_idx', 'Order_status_updatedAt_idx',
    'Order_deliverySlot_idx', 'Order_customerPhone_createdAt_idx'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = esperado) THEN
      faltantes := faltantes || ('índice ' || esperado);
    END IF;
  END LOOP;

  IF cardinality(faltantes) > 0 THEN
    RAISE EXCEPTION 'El esquema no es el que espera el código. Falta o no coincide: %', array_to_string(faltantes, '; ');
  END IF;
END $$;
