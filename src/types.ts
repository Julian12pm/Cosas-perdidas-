/*
 * El vocabulario de la app.
 *
 * Aquí viven las formas que el navegador dibuja. Son las del API con otro
 * nombre: el API manda `kind`, `zone` y `created_at` en milisegundos; la app
 * dibuja `type`, `zoneLabel` y `timestamp` en ISO. La traducción está en
 * `src/data.ts` y en `src/api.ts`, y estos tipos son su contrato.
 *
 * Los tipos que el API ya valida (el reporte público, la sesión, el resumen
 * del reclamo) NO se re-declaran aquí: se heredan de sus esquemas de zod, con
 * `import type`, así que el bundle no carga nada extra y un cambio en el
 * contrato rompe la compilación de la app.
 */

import type { z } from 'zod';
import type { claimSummarySchema } from '#contracts';
import type { ContactCard } from '#domain/blind-report';
import type { ClaimStatus, ReportKind, ReportStatus } from '#domain/claims';
import type { SessionUser } from '#auth/session';

export type { ClaimStatus, ContactCard, ReportKind, ReportStatus, SessionUser };

/** El reclamo tal como lo lista la bandeja: el resumen que devuelve el API. */
export type ClaimSummary = z.infer<typeof claimSummarySchema>;

/** De quién es el reclamo: lo que recibe el estudiante o lo que él envió. */
export type ClaimDirection = ClaimSummary['direction'];

/** La sesión con la que corre la app. */
export type Session = SessionUser;

/* ────────────────────────────── El croquis ────────────────────────────── */

/** Un punto en el espacio del artwork (unidades de usuario del viewBox). */
export interface Point {
  x: number;
  y: number;
}

/** Un vértice del polígono: el par tal como lo guarda el catálogo. */
export type Vertex = [number, number];

/** Un polígono del catálogo: unidades absolutas del SVG. */
export type Polygon = Vertex[];

/** La caja que ocupa una zona en el artwork. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** La imagen del croquis y su tamaño natural. */
export interface MapImage {
  src: string;
  width: number;
  height: number;
}

/**
 * La especie de una zona del catálogo.
 *
 * La misma lista que usa la tabla del API: el catálogo es la fuente única
 * del campus y las dos partes (el mapa y la base) hablan de sus zonas con
 * estas palabras.
 */
export type ZoneKind = 'building' | 'parking' | 'meeting_point' | 'internet_module' | 'track';

/** Una zona del catálogo del campus. */
export interface Zone {
  id: string;
  code: string | null;
  name: string;
  unit: string;
  kind: ZoneKind;
  safePoint: boolean;
  label: string;
  box: Box;
  polygon: Polygon;
  /** Las construcciones partidas en dos: cada ala es una forma de su cuenta. */
  fragments?: Polygon[];
}

/* ───────────────────────────── Los reportes ───────────────────────────── */

/**
 * El reporte como lo dibuja la app.
 *
 * No es el reporte del API: es su proyección. `type` es el color del pin,
 * `x`/`y` son porcentajes del croquis y `timestamp` es una fecha ISO.
 */
export interface Report {
  id: string;
  type: ReportKind;
  /** Porcentaje del ancho del croquis. */
  x: number;
  /** Porcentaje de la altura del croquis. */
  y: number;
  zoneId: string | null;
  zoneLabel: string | null;
  item: string;
  description: string;
  /** El dueño es la sesión: nadie más publica con su nombre. */
  ownerId: string | null;
  alias: string;
  status: ReportStatus;
  /** Fecha ISO de la publicación. */
  timestamp: string;
  /** La clave se ve una sola vez, cuando se publica el reporte. */
  releaseKey: string | null;
  releaseAttempts?: number;
  releaseMaxAttempts?: number;
  /** El dato ciego es privado: lo ve quien encontró el objeto, nadie más. */
  blindDetail: string | null;
  /** El reporte perdido con el que está enlazado un hallazgo. */
  linkedLostReportId?: string;
  /** El punto seguro donde el objeto quedó en resguardo. */
  safePointZoneId?: string | null;
}

/**
 * El reclamo como lo lista la bandeja.
 *
 * El contacto se pide después de aprobar: mientras tanto es `null`.
 */
export interface Claim {
  id: string;
  reportId: string;
  reportTitle: string;
  claimantId?: string;
  claimantAlias: string;
  providedBlindDetail: string | null;
  message: string | null;
  status: ClaimStatus;
  direction: ClaimDirection;
  /** Fecha ISO de la creación del reclamo. */
  createdAt: string;
  contact: ContactCard | null;
}
