/*
 * Los ganchos que la página comparte con las pruebas.
 *
 * `__campusFailure` es el botón de emergencia de la demostración: el journey
 * lo enciende para ver cómo se ve una pantalla con el campus caído. Es un
 * gancho de la app (no de la prueba), así que su tipo vive con la app.
 */

export {};

declare global {
  interface Window {
    /** La carga del campus falla como fallaría un campus caído. */
    __campusFailure?: boolean;
  }
}

/**
 * Las propiedades de CSS que el app escribe a mano en un `style`: React sólo
 * las acepta si están declaradas.
 */
declare module 'react' {
  interface CSSProperties {
    /** La escala con la que se dibuja el pin, la que el croquis mide. */
    '--pin-scale'?: number | string;
    /** El zoom del croquis: las etiquetas que no son arte lo consultan. */
    '--zoom'?: number | string;
  }
}
