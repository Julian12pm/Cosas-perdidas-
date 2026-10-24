import type { OwnerReport, PublicReport } from '#domain/blind-report';
import { getContactCard, getReport, isApiConfigured, listInbox, listReports } from './api.ts';
import { artworkToPercent, polygonCentroid } from './map/geometry.ts';
import { MAP_IMAGE, ZONE_BY_ID } from './map/zones.ts';
import type { Claim, ClaimSummary, Contact, Report, ReportStatus, Session } from './types.ts';

// Longitud de la clave de liberación: el dueño del objeto la dicta al
// estudiante que lo tiene físicamente. Seis dígitos = un millón de combinaciones.
export const RELEASE_KEY_LENGTH = 6;

// Intentos que puede quemar el estudiante que tiene el objeto antes de que su
// pareja (clave, portador) quede en espera. La clave nunca se bloquea:
// bloquearla sería un ataque de denegación de servicio contra el dueño.
export const RELEASE_KEY_MAX_ATTEMPTS = 5;

// Los dominios que el instituto usa para sus buzones: el correo institucional
// es la identidad, no hay registro anónimo.
export const INSTITUTIONAL_DOMAINS: string[] = ['morelia.tecnm.mx', 'itmorelia.edu.mx'];

// Los estados de un reporte, como los lee el estudiante.
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: 'Abierto',
  pending_claim: 'Esperando reclamo',
  in_custody: 'En resguardo',
  resolved: 'Resuelto',
  expired: 'Expirado',
  archived: 'Archivado',
};

// Un estado que la app no conoce se dice en español: nunca se muestra el
// enumerador crudo (que es inglés y no le dice nada al estudiante).
export const UNKNOWN_STATUS_LABEL = 'Sin estado';

// La sesión con la que corre la demostración cuando no hay API configurada.
export const MOCK_SESSION: Session = {
  id: 'usr-demo-01',
  email: 'L2030451@morelia.tecnm.mx',
  displayName: 'María Fernanda Ruiz',
  role: 'student',
};

// Los demás estudiantes del campus que aparecen en los datos de arranque.
const MOCK_STUDENTS: Record<string, { displayName: string; email: string } | undefined> = {
  'usr-demo-02': { displayName: 'Ana Lucía Ramírez', email: 'L2030452@morelia.tecnm.mx' },
  'usr-demo-03': { displayName: 'Miguel Ángel Ríos', email: 'L1820447@morelia.tecnm.mx' },
};

/**
 * La tarjeta de contacto de un estudiante del arranque; null cuando no se
 * conoce. El contacto sólo se libera después de aprobar un reclamo.
 */
export function contactFor(userId: string): Contact | null {
  if (userId === MOCK_SESSION.id) {
    return { display_name: MOCK_SESSION.displayName ?? '', email: MOCK_SESSION.email };
  }
  const student = MOCK_STUDENTS[userId];
  if (!student) return null;
  return { display_name: student.displayName, email: student.email };
}

/**
 * Alias estable derivado del identificador del usuario, con la misma forma que
 * usa el API: `Estudiante #XXXX`. Vive aquí y no en `api/` porque el paquete
 * del navegador no puede arrastrar código de servidor.
 */
export function reporterAlias(userId: string): string {
  return `Estudiante #${aliasSuffix(userId)}`;
}

/** Los cuatro últimos dígitos del hash FNV-1a del identificador, en base 36. */
function aliasSuffix(id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

/**
 * La misma regla que el API: sólo un buzón de un dominio del instituto abre
 * una sesión. Un subdominio se rechaza, o `evil.morelia.tecnm.mx` pasaría.
 */
export function isInstitutionalEmail(email: string | null | undefined): boolean {
  const trimmed = String(email ?? '').trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return false;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (local.length === 0 || domain.length === 0 || local.includes('@')) return false;

  return INSTITUTIONAL_DOMAINS.includes(domain);
}

/**
 * Copia un texto al portapapeles; devuelve si el navegador lo permitió, para
 * que la interfaz pueda avisar cuando el portapapeles no está disponible.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Los pines de ejemplo apuntan a zonas reales del catálogo, para que los datos
// de arranque no describan un campus que no existe.
function mockZone(zoneId: string): { zoneId: string; zoneLabel: string } {
  const zone = ZONE_BY_ID.get(zoneId);
  if (!zone) throw new Error(`la zona de arranque ${zoneId} no está en el catálogo`);
  return { zoneId: zone.id, zoneLabel: zone.label };
}

/** Una marca de tiempo de hace unas horas, para que la demo nunca envejezca. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

// Datos ficticios iniciales de objetos perdidos/encontrados en el campus.
// Cada reporte lleva su dueño: la identidad es la del estudiante que entró
// con su correo institucional, nunca un nombre escrito a mano.
export const MOCK_PINS: Report[] = [
  {
    id: 'pin-1',
    type: 'lost', // Pin Rojo - "Perdí algo aquí"
    x: 41.96, // Centro de E · Aulas y Taller de Dibujo
    y: 30.6,
    item: 'Laptop HP gris con sticker de React',
    description: 'Olvidé mi laptop en el edificio E, segundo piso, aula E3.',
    ownerId: MOCK_SESSION.id,
    alias: reporterAlias(MOCK_SESSION.id),
    status: 'pending_claim',
    timestamp: hoursAgo(26),
    releaseKey: '483921',
    releaseAttempts: 0,
    releaseMaxAttempts: RELEASE_KEY_MAX_ATTEMPTS,
    blindDetail: null,
    ...mockZone('bldg-e'),
  },
  {
    id: 'pin-2',
    type: 'found', // Pin Verde - "Encontré algo aquí"
    x: 39.18, // Centro de R · Cafetería
    y: 57.34,
    item: 'Calculadora científica',
    description: 'Encontrada en una banca cerca de la cafetería.',
    ownerId: 'usr-demo-02',
    alias: reporterAlias('usr-demo-02'),
    status: 'open',
    timestamp: hoursAgo(5),
    releaseKey: null,
    releaseAttempts: 0,
    releaseMaxAttempts: RELEASE_KEY_MAX_ATTEMPTS,
    // El dato ciego es privado: lo ve quien encontró el objeto, nadie más.
    blindDetail: 'Marca Casio fx-991SP, gris claro, con un lapicero azul pegado con cinta.',
    ...mockZone('bldg-r'),
  },
  {
    id: 'pin-3',
    type: 'lost', // Pin Rojo
    x: 65.37, // Centro de Pista de Atletismo
    y: 35.32,
    item: 'Mochila negra Jansport',
    description: 'La dejé en las gradas de la pista de atletismo durante el entrenamiento.',
    ownerId: 'usr-demo-03',
    alias: reporterAlias('usr-demo-03'),
    status: 'open',
    timestamp: hoursAgo(40),
    releaseKey: '319047',
    releaseAttempts: 0,
    releaseMaxAttempts: RELEASE_KEY_MAX_ATTEMPTS,
    blindDetail: null,
    ...mockZone('track-1'),
  },
  {
    id: 'pin-4',
    type: 'found', // Pin Verde - "Encontré esto, ¿de quién es?"
    x: 47.28, // Centro de Estacionamiento 5
    y: 12.52,
    item: 'Laptop gris con una pegatina',
    description: 'Encontrada en el Estacionamiento 5, junto a un auto azul.',
    ownerId: MOCK_SESSION.id,
    alias: reporterAlias(MOCK_SESSION.id),
    status: 'open',
    timestamp: hoursAgo(2),
    releaseKey: null,
    releaseAttempts: 0,
    releaseMaxAttempts: RELEASE_KEY_MAX_ATTEMPTS,
    blindDetail: 'Marca HP Pavilion gris, pegatina de React en la tapa, dentro una mochila azul.',
    // La demostración empareja el reporte perdido con el encontrado de la
    // misma sesión: así un estudiante puede recorrer la entrega completa sin
    // un segundo navegador. En el API las dos partes son personas distintas.
    linkedLostReportId: 'pin-1',
    ...mockZone('parking-5'),
  },
];

// Los reclamos del arranque: uno recibido contra el reporte de la sesión y
// uno enviado por ella. El contacto de un reclamo se libera al aprobarlo.
export const MOCK_CLAIMS: Claim[] = [
  {
    id: 'claim-1',
    reportId: 'pin-1',
    reportTitle: 'Laptop HP gris con sticker de React',
    claimantId: 'usr-demo-03',
    claimantAlias: reporterAlias('usr-demo-03'),
    providedBlindDetail: 'Es una HP Pavilion gris con una pegatina de React en la tapa.',
    message: 'La dejé en el salón E3 la tarde del jueves.',
    status: 'pending',
    direction: 'incoming',
    createdAt: hoursAgo(4),
    contact: null,
  },
  {
    id: 'claim-2',
    reportId: 'pin-2',
    reportTitle: 'Calculadora científica',
    claimantId: MOCK_SESSION.id,
    claimantAlias: reporterAlias(MOCK_SESSION.id),
    providedBlindDetail: 'Marca Casio fx-991SP, gris claro, con un lapicero azul pegado con cinta.',
    message: 'La calculadora es mía, la perdí en la cafetería.',
    status: 'pending',
    direction: 'outgoing',
    createdAt: hoursAgo(1),
    contact: null,
  },
];

// Genera una clave de liberación aleatoria y uniforme.
// Math.random no sirve para un secreto: usa el generador criptográfico del
// navegador y descarta los valores sesgados para mantener la distribución.
export function generateUnlockCode(): string {
  const limit = 10 ** RELEASE_KEY_LENGTH;
  const ceiling = Math.floor(0xffffffff / limit) * limit;
  const buffer = new Uint32Array(1);

  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= ceiling);

  return String(value % limit).padStart(RELEASE_KEY_LENGTH, '0');
}

// Formatear fecha legible
export function formatTimestamp(ts: string | number): string {
  const date = new Date(ts);
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  return date.toLocaleDateString('es-MX', options);
}

/** Qué tan viejo es un reporte, en palabras y sin decir la hora exacta. */
export function formatAge(timestamp: string | number): string {
  const then = new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return '';

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'Hace un momento';
  if (minutes < 60) return `Hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hace 1 día';
  if (days < 7) return `Hace ${days} días`;

  const weeks = Math.floor(days / 7);
  if (weeks === 1) return 'Hace 1 semana';
  if (weeks < 5) return `Hace ${weeks} semanas`;

  const months = Math.max(1, Math.floor(days / 30));
  return months === 1 ? 'Hace 1 mes' : `Hace ${months} meses`;
}

/**
 * Cuánto tarda la demostración en responder. La pantalla de carga dura lo que
 * duraría una petición real, para que el estado no sea decorativo y se vea
 * igual cuando el campus responda de verdad.
 */
export const DEMO_LATENCY_MS = 250;

/* ─────────────────────────── El campus del API ─────────────────────────── */

/**
 * La posición de un pin: el API manda los píxeles del artwork y el mapa
 * trabaja con porcentajes, como los pines de la demostración.
 *
 * La vista del dueño no lleva posición: un reporte colocado por zona se
 * dibuja en el centro de su zona.
 */
function positionOf(report: PublicReport | OwnerReport): { x: number; y: number } {
  const x = 'map_x' in report ? Number(report.map_x) : Number.NaN;
  const y = 'map_y' in report ? Number(report.map_y) : Number.NaN;
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const percent = artworkToPercent({ x, y }, MAP_IMAGE);
    return { x: round2(percent.x), y: round2(percent.y) };
  }

  // Un reporte colocado por zona cae en el centro de la zona.
  const zone = ZONE_BY_ID.get(report.zone);
  const centroid = zone ? polygonCentroid(zone.polygon ?? []) : null;
  if (!centroid) return { x: 0, y: 0 };
  const percent = artworkToPercent(centroid, MAP_IMAGE);
  return { x: round2(percent.x), y: round2(percent.y) };
}

/** Dos decimales: el pin se ve igual con más. */
function round2(value: number): number {
  return parseFloat(value.toFixed(2));
}

/**
 * El reporte como la app lo dibuja.
 *
 * El API manda dos vistas: la pública (todos la ven) y la del dueño (el dato
 * ciego y el contacto). La app necesita una sola forma, así que la vista del
 * dueño se encima de la pública cuando la hay.
 */
export function reportFromApi(
  report: PublicReport | OwnerReport,
  { session, owner = null }: { session: Session; owner?: OwnerReport | null },
): Report {
  const mine = report.alias === reporterAlias(session.id);
  const zone = ZONE_BY_ID.get(report.zone);

  return {
    id: report.id,
    type: report.kind,
    ...positionOf(report),
    zoneId: report.zone,
    zoneLabel: zone?.label ?? null,
    item: report.title,
    description: report.public_description,
    // El dueño es la sesión: nadie más puede publicar con su nombre.
    ownerId: mine ? session.id : null,
    alias: report.alias,
    status: report.status,
    timestamp: new Date(report.created_at).toISOString(),
    // La clave se ve una sola vez, cuando se publica el reporte.
    releaseKey: null,
    releaseAttempts: undefined,
    releaseMaxAttempts: undefined,
    blindDetail: owner?.blind_detail ?? null,
    safePointZoneId: owner?.safe_point_zone ?? null,
  };
}

/** El reclamo como la bandeja lo lista. */
export function claimFromApi(claim: ClaimSummary): Claim {
  return {
    id: claim.id,
    reportId: claim.reportId,
    reportTitle: claim.reportTitle,
    claimantAlias: claim.claimantAlias,
    providedBlindDetail: claim.providedBlindDetail,
    message: null,
    status: claim.status,
    direction: claim.direction,
    createdAt: new Date(claim.createdAt).toISOString(),
    // El contacto sólo se pide después de aprobar el reclamo.
    contact: null,
  };
}

/**
 * El campus como lo sabe el API: los pines del mapa, los reportes del
 * estudiante y los reclamos de la bandeja.
 *
 * Los pines son la proyección pública de todos los reportes; los del propio
 * estudiante se piden otra vez para leer su dato ciego, que el mapa no
 * publica.
 */
async function loadApiCampus(session: Session): Promise<{
  reports: Report[];
  claims: Claim[];
}> {
  const [pins, inbox] = await Promise.all([listReports(), listInbox()]);
  const mine = pins.filter((pin) => pin.alias === reporterAlias(session.id));
  const owned = await Promise.all(mine.map((pin) => getReport(pin.id)));
  const owners = new Map(owned.map((owner) => [owner.id, owner]));

  const reports = pins.map((pin) =>
    reportFromApi(pin, { session, owner: owners.get(pin.id) ?? null }),
  );
  const claims = inbox.map(claimFromApi);

  // El contacto de un reclamo aprobado se pide por su reporte: es el único
  // que lo suelta, y sólo después de la aprobación.
  await Promise.all(
    claims
      .filter((claim) => claim.status === 'approved')
      .map(async (claim) => {
        try {
          claim.contact = await getContactCard(claim.reportId);
        } catch {
          // Sin tarjeta el reclamo sigue en la bandeja, pero sin contacto.
        }
      }),
  );

  return { reports, claims };
}

/**
 * Los datos del campus: los reportes del mapa y los reclamos de la bandeja.
 * La demostración responde como un servidor: tarda lo que tardaría la
 * petición y, sin conexión, la petición ni siquiera llega.
 *
 * La demostración también sabe caerse: con `window.__campusFailure` la carga
 * falla como lo haría un campus caído, para que el estado de error sea un
 * estado de verdad y no una rama muerta.
 *
 * Con un API configurado el campus es el de verdad: los pines, los reportes
 * y los reclamos salen de la base de datos.
 */
export async function loadCampusData(session: Session): Promise<{
  reports: Report[];
  claims: Claim[];
}> {
  if (isApiConfigured()) return loadApiCampus(session);

  await new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('offline');
  }
  if (typeof window !== 'undefined' && window.__campusFailure === true) {
    throw new Error('campus-unavailable');
  }
  return { reports: MOCK_PINS, claims: MOCK_CLAIMS };
}
