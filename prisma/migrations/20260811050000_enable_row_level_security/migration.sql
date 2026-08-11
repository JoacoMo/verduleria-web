-- Row Level Security + cierre de permisos públicos.
--
-- Contexto: Supabase expone automáticamente todas las tablas del schema `public`
-- por su API REST (PostgREST), usando los roles `anon` y `authenticated`. La
-- `anon key` está pensada para ser pública (va embebida en apps de frontend), así
-- que hay que asumir que cualquiera la puede tener.
--
-- Estado antes de esta migración:
--   - Product: RLS DESACTIVADO y `anon` con SELECT/INSERT/UPDATE/DELETE/TRUNCATE.
--     Es decir: cualquiera con la anon key podía borrar el catálogo entero.
--   - Order: RLS activo y sin políticas (denegaba todo), pero con los mismos grants.
--   - _prisma_migrations: RLS desactivado y expuesta igual.
--
-- Esta app NO usa la API de Supabase: se conecta con Prisma como el rol `postgres`,
-- que es dueño de las tablas. Los dueños no están sujetos a RLS mientras no se use
-- FORCE ROW LEVEL SECURITY, así que la aplicación sigue funcionando igual.
--
-- Criterio: denegar por defecto. Se activa RLS y NO se crea ninguna política, que
-- en Postgres significa "nadie que esté sujeto a RLS puede ver ni tocar nada".
-- Además se revocan los permisos, que es una segunda barrera independiente.

-- 1) RLS en todas las tablas del schema public.
ALTER TABLE "public"."Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- 2) Se les saca a los roles de la API pública todo permiso sobre las tablas.
--    Sin GRANT, PostgREST devuelve error de permisos incluso con una key válida.
REVOKE ALL ON "public"."Product" FROM anon, authenticated;
REVOKE ALL ON "public"."Order" FROM anon, authenticated;
REVOKE ALL ON "public"."_prisma_migrations" FROM anon, authenticated;

-- 3) Las secuencias de los id también quedan fuera de alcance.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM anon, authenticated;

-- 4) Que ninguna tabla futura nazca accesible: se cambian los privilegios por
--    defecto para lo que cree el rol postgres de acá en adelante.
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM anon, authenticated;
