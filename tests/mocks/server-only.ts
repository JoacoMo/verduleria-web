/**
 * Reemplazo de `server-only` para los tests.
 *
 * El paquete real tira un error si se importa fuera de un bundle de React Server
 * Components (es su manera de cortar el build cuando un módulo de servidor se
 * cuela en el navegador). En Vitest no hay bundle de RSC, así que se lo
 * reemplaza por un módulo vacío desde el alias de vitest.config.ts.
 */
export {};
