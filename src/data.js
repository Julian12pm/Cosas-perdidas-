import { ZONE_BY_ID } from './map/zones.js';

// Longitud de la clave de liberación: el dueño del objeto la dicta al
// estudiante que lo tiene físicamente. Seis dígitos = un millón de combinaciones.
export const RELEASE_KEY_LENGTH = 6;

// Los pines de ejemplo apuntan a zonas reales del catálogo, para que los datos
// de arranque no describan un campus que no existe.
function mockZone(zoneId) {
  const zone = ZONE_BY_ID.get(zoneId);
  return { zoneId: zone.id, zoneLabel: zone.label };
}

// Datos ficticios iniciales de objetos perdidos/encontrados en el campus
export const MOCK_PINS = [
  {
    id: 'pin-1',
    type: 'lost', // Pin Rojo - "Perdí algo aquí"
    x: 41.96, // Centro de E · Aulas y Taller de Dibujo
    y: 30.6,
    item: 'Laptop HP gris con sticker de React',
    description: 'Olvidé mi laptop en el edificio E, segundo piso, aula E3.',
    reportedBy: 'Carlos M.',
    timestamp: '2026-09-28T14:30:00',
    unlockCode: '483921',
    ...mockZone('bldg-e'),
  },
  {
    id: 'pin-2',
    type: 'found', // Pin Verde - "Encontré algo aquí"
    x: 39.18, // Centro de R · Cafetería
    y: 57.34,
    item: 'Calculadora científica Casio fx-991',
    description: 'Encontrada en banca cerca de la cafetería.',
    reportedBy: 'Ana L.',
    timestamp: '2026-09-29T09:15:00',
    unlockCode: '726104',
    ...mockZone('bldg-r'),
  },
  {
    id: 'pin-3',
    type: 'lost', // Pin Rojo
    x: 65.37, // Centro de Pista de Atletismo
    y: 35.32,
    item: 'Mochila negra Jansport',
    description: 'La dejé en las gradas de la pista de atletismo durante el entrenamiento.',
    reportedBy: 'Miguel R.',
    timestamp: '2026-09-29T17:45:00',
    unlockCode: '550183',
    ...mockZone('track-1'),
  },
  {
    id: 'pin-4',
    type: 'found', // Pin Verde
    x: 47.28, // Centro de Estacionamiento 5
    y: 12.52,
    item: 'Credencial del TEC a nombre de...',
    description: 'Encontrada en estacionamiento. No se revela el nombre completo.',
    reportedBy: 'Laura G.',
    timestamp: '2026-09-29T12:00:00',
    unlockCode: '319047',
    ...mockZone('parking-5'),
  },
];

// Genera una clave de liberación aleatoria y uniforme.
// Math.random no sirve para un secreto: usa el generador criptográfico del
// navegador y descarta los valores sesgados para mantener la distribución.
export function generateUnlockCode() {
  const limit = 10 ** RELEASE_KEY_LENGTH;
  const ceiling = Math.floor(0xffffffff / limit) * limit;
  const buffer = new Uint32Array(1);

  let value;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= ceiling);

  return String(value % limit).padStart(RELEASE_KEY_LENGTH, '0');
}

// Formatear fecha legible
export function formatTimestamp(ts) {
  const date = new Date(ts);
  const options = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  return date.toLocaleDateString('es-MX', options);
}
