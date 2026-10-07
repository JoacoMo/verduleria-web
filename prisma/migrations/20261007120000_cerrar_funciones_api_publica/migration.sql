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
--
-- Función por función y solo las del rol que migra (o de un rol del que es
-- miembro): un REVOKE ON ALL FUNCTIONS falla entero con "permission denied" si
-- hay en public una función de otro dueño (por ejemplo, de una extensión
-- instalada por Supabase) sobre la que este rol no tiene ningún privilegio.
-- Las que se saltean se avisan con un NOTICE en el log del deploy.
DO $$
DECLARE
  rutina record;
BEGIN
  FOR rutina IN
    SELECT p.oid::regprocedure AS firma, pg_has_role(p.proowner, 'USAGE') AS propia
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    IF rutina.propia THEN
      EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, anon, authenticated', rutina.firma);
    ELSE
      RAISE NOTICE 'Función de otro dueño, no se toca: %', rutina.firma;
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
