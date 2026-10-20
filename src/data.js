// Datos ficticios iniciales de objetos perdidos/encontrados en el campus
export const MOCK_PINS = [
  {
    id: 'pin-1',
    type: 'lost', // Pin Rojo - "Perdí algo aquí"
    x: 40.5, // Edificio E - Aulas
    y: 31,
    item: 'Laptop HP gris con sticker de React',
    description: 'Olvidé mi laptop en el edificio E, segundo piso, aula E3.',
    reportedBy: 'Carlos M.',
    timestamp: '2026-09-28T14:30:00',
    unlockCode: '1234',
    zone: 'Edificio E - Aulas',
  },
  {
    id: 'pin-2',
    type: 'found', // Pin Verde - "Encontré algo aquí"
    x: 37.5, // Cafetería (R)
    y: 58.5,
    item: 'Calculadora científica Casio fx-991',
    description: 'Encontrada en banca cerca de la cafetería.',
    reportedBy: 'Ana L.',
    timestamp: '2026-09-29T09:15:00',
    unlockCode: '1234',
    zone: 'Cafetería',
  },
  {
    id: 'pin-3',
    type: 'lost', // Pin Rojo
    x: 60.5, // Pista de Atletismo
    y: 35.0,
    item: 'Mochila negra Jansport',
    description: 'La dejé en las gradas de la pista de atletismo durante el entrenamiento.',
    reportedBy: 'Miguel R.',
    timestamp: '2026-09-29T17:45:00',
    unlockCode: '9012',
    zone: 'Pista de Atletismo',
  },
  {
    id: 'pin-4',
    type: 'found', // Pin Verde
    x: 44.0, // Estacionamiento 5
    y: 15.0,
    item: 'Credencial del TEC a nombre de...',
    description: 'Encontrada en estacionamiento. No se revela el nombre completo.',
    reportedBy: 'Laura G.',
    timestamp: '2026-09-29T12:00:00',
    unlockCode: '3456',
    zone: 'Estacionamiento 5',
  },
];

// Generar un código aleatorio de 4 dígitos
export function generateUnlockCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
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
