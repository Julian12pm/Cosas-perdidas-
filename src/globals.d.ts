/*
 * Los ganchos que la página comparte con las pruebas.
 *
 * `__campusFailure` es el botón de emergencia de la demostración: el journey
 * lo enciende para ver cómo se ve una pantalla con el campus caído. Es un
 * gancho de la app (no de la prueba), así que su tipo vive con la app.
 */

interface Window {
  /** La carga del campus falla como fallaría un campus caído. */
  __campusFailure?: boolean;
}
