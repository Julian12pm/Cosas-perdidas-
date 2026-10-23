/*
 * pngjs no trae sus tipos, y el proyecto no los instala: lo que el
 * extractor y las pruebas usan de él está declarado aquí, con lo que usan.
 */

declare module 'pngjs' {
  /** El PNG que el script lee: los píxeles y su tamaño. */
  export class PNG {
    constructor(options?: { width?: number; height?: number });
    static sync: {
      read(data: Uint8Array): PNG;
      write(png: PNG): Buffer;
    };
    width: number;
    height: number;
    /** Los píxeles, en RGBA. */
    data: Buffer;
  }
}
