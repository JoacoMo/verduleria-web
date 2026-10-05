-- Cierra la ejecución de funciones del schema public a la API pública de Supabase.
--
-- Postgres le da EXECUTE a PUBLIC en toda función nueva y Supabase además se lo
-- da a anon/authenticated en el schema public. Hoy no hay ninguna función, pero
-- la primera que se agregue (sobre todo una SECURITY DEFINER) quedaría invocable
-- con la anon key por /rest/v1/rpc/<nombre>, salteando el REVOKE y el RLS de las
-- tablas.
--
-- Lo que ya exista se cierra acá. Para las futuras se sacan los privilegios por
-- defecto de anon/authenticated en public. El EXECUTE a PUBLIC es un default
-- GLOBAL de Postgres y no se toca acá (afectaría a funciones internas de
-- Supabase en otros schemas): toda migración que cree una función en public
-- tiene que hacer `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated;`.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
