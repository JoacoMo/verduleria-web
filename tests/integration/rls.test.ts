import { expect, it } from 'vitest';
import { describeDb, prisma } from './helpers';

/**
 * Supabase expone el schema public por su API REST con la anon key, que es
 * pública. La app no usa esa API (entra con Prisma como dueño de las tablas), así
 * que nada de public tiene que quedar accesible para anon/authenticated.
 *
 * Estos tests fallan si una migración nueva crea una tabla sin RLS o le deja
 * permisos a la API pública: es la red para "la tabla nueva que alguien se
 * olvidó de cerrar".
 */
describeDb('permisos de la base para la API pública de Supabase', () => {
  it('todas las tablas de public tienen RLS activado', async () => {
    const rows = await prisma.$queryRaw<Array<{ relname: string }>>`
      SELECT c.relname
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind = 'r'
        AND NOT c.relrowsecurity
    `;
    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it('anon y authenticated no tienen ningún permiso sobre tablas ni secuencias de public', async () => {
    const rows = await prisma.$queryRaw<Array<{ grantee: string; table_name: string; privilege_type: string }>>`
      SELECT grantee, table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
    `;
    expect(rows).toEqual([]);

    const sequences = await prisma.$queryRaw<Array<{ sequence_name: string }>>`
      SELECT c.relname AS sequence_name
      FROM pg_class c
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind = 'S'
        AND has_sequence_privilege(r.role, c.oid, 'USAGE, SELECT, UPDATE')
    `;
    expect(sequences).toEqual([]);
  });

  it('ninguna función de public se puede ejecutar desde la API pública', async () => {
    const rows = await prisma.$queryRaw<Array<{ proname: string }>>`
      SELECT p.proname
      FROM pg_proc p
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
      WHERE p.pronamespace = 'public'::regnamespace
        AND has_function_privilege(r.role, p.oid, 'EXECUTE')
    `;
    expect(rows).toEqual([]);
  });
});
