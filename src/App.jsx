import React, { useState, useCallback, useRef } from 'react';
import { MOCK_PINS, generateUnlockCode, formatTimestamp } from './data.js';

/* ─────────────────────────── Iconos inline ─────────────────────────── */
const IconLost = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    <path d="M11 8v6M8 11h6" strokeLinecap="round" />
  </svg>
);

const IconFound = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    <path d="M8 11l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconClose = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const IconLock = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const IconPin = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" />
  </svg>
);

const IconShield = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const IconInfo = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
  </svg>
);

/* ────────────────────────── Componente Pin ────────────────────────── */
function MapPin({ pin, onClick }) {
  const isLost = pin.type === 'lost';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(pin); }}
      className={`absolute z-10 -translate-x-1/2 -translate-y-full cursor-pointer group animate-pin-drop`}
      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
      title={`${isLost ? '🔴 Perdido' : '🟢 Encontrado'}: ${pin.item}`}
      aria-label={`Pin ${isLost ? 'perdido' : 'encontrado'}: ${pin.item}`}
    >
      <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-3 h-1.5 rounded-full bg-black/40 blur-sm`} />
      <div className={`relative flex flex-col items-center`}>
        <div className={`
          w-8 h-8 rounded-full flex items-center justify-center
          shadow-lg border-2 border-white/80 transition-all duration-300
          group-hover:scale-125 group-hover:shadow-xl
          ${isLost
            ? 'bg-gradient-to-br from-red-500 to-red-700 animate-pin-pulse'
            : 'bg-gradient-to-br from-green-500 to-green-700 animate-pin-pulse-green'}
        `}>
          <span className="text-white text-xs font-bold drop-shadow">
            {isLost ? '?' : '✓'}
          </span>
        </div>
        <div className={`
          w-0 h-0 -mt-0.5
          border-l-[6px] border-l-transparent
          border-r-[6px] border-r-transparent
          ${isLost ? 'border-t-[8px] border-t-red-700' : 'border-t-[8px] border-t-green-700'}
        `} />
      </div>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-surface-900/95 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none backdrop-blur-sm shadow-xl">
        <span className={isLost ? 'text-red-400' : 'text-green-400'}>
          {isLost ? '📍 Perdido' : '📍 Encontrado'}
        </span>
        <span className="text-surface-300 ml-1">· {pin.item.length > 25 ? pin.item.slice(0, 25) + '...' : pin.item}</span>
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-surface-900/95" />
      </div>
    </button>
  );
}

/* ──────────────────── Modal contenedor reutilizable ──────────────── */
function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-backdrop-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-md animate-modal-in" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/* ──────────────── Modal: Elegir tipo de pin ──────────────── */
function PinTypeModal({ onClose, onSelect }) {
  return (
    <Modal onClose={onClose}>
      <div className="bg-gradient-to-br from-surface-800 to-surface-900 rounded-2xl border border-surface-600/50 shadow-2xl overflow-hidden">
        <div className="relative px-6 pt-6 pb-4">
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg bg-surface-700/50 text-surface-400 hover:text-white hover:bg-surface-600 transition-all cursor-pointer">
            <IconClose />
          </button>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-brand-500/20 flex items-center justify-center">
              <IconPin />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Nuevo Marcador</h2>
              <p className="text-sm text-surface-400">¿Qué deseas reportar?</p>
            </div>
          </div>
        </div>
        <div className="px-6 pb-6 space-y-3">
          <button onClick={() => onSelect('lost')} className="w-full group flex items-center gap-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 transition-all duration-300 cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-lg shadow-red-500/25 group-hover:scale-110 transition-transform">
              <span className="text-white text-lg">?</span>
            </div>
            <div className="text-left">
              <h3 className="text-white font-semibold text-base">🔴 Perdí algo aquí</h3>
              <p className="text-red-300/70 text-sm">Marca el lugar donde perdiste tu objeto</p>
            </div>
          </button>
          <button onClick={() => onSelect('found')} className="w-full group flex items-center gap-4 p-4 rounded-xl bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 hover:border-green-500/40 transition-all duration-300 cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center shadow-lg shadow-green-500/25 group-hover:scale-110 transition-transform">
              <span className="text-white text-lg">✓</span>
            </div>
            <div className="text-left">
              <h3 className="text-white font-semibold text-base">🟢 Encontré algo aquí</h3>
              <p className="text-green-300/70 text-sm">Reporta un objeto encontrado de forma segura</p>
            </div>
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────── Modal: Formulario Lost (Rojo) ──────────────── */
function LostFormModal({ onClose, onSubmit, position }) {
  const [item, setItem] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!item.trim()) return;
    onSubmit({ item: item.trim(), description: description.trim(), reportedBy: name.trim() || 'Anónimo' });
  };

  return (
    <Modal onClose={onClose}>
      <div className="bg-gradient-to-br from-surface-800 to-surface-900 rounded-2xl border border-surface-600/50 shadow-2xl overflow-hidden">
        <div className="relative px-6 pt-6 pb-4">
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg bg-surface-700/50 text-surface-400 hover:text-white hover:bg-surface-600 transition-all cursor-pointer">
            <IconClose />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-lg">
              <IconLost />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Reportar Objeto Perdido</h2>
              <p className="text-sm text-surface-400">🔴 Pin Rojo</p>
            </div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">¿Qué perdiste? *</label>
            <input type="text" value={item} onChange={(e) => setItem(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-surface-700/50 border border-surface-600/50 text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-red-500/50" required autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">Descripción (opcional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows="3" className="w-full px-4 py-3 rounded-xl bg-surface-700/50 border border-surface-600/50 text-white resize-none focus:outline-none focus:ring-2 focus:ring-red-500/50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">Tu nombre (opcional)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-surface-700/50 border border-surface-600/50 text-white focus:outline-none focus:ring-2 focus:ring-red-500/50" />
          </div>
          <button type="submit" disabled={!item.trim()} className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-red-600 to-red-700 text-white font-semibold shadow-lg hover:from-red-500 hover:to-red-600 disabled:opacity-40 transition-all cursor-pointer">
            📌 Clavar Pin Rojo
          </button>
        </form>
      </div>
    </Modal>
  );
}

/* ──────────────── Modal: Formulario Found (Verde) ──────────────── */
function FoundFormModal({ onClose, onSubmit, position }) {
  const [item, setItem] = useState('');
  const [name, setName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!item.trim()) return;
    onSubmit({ item: item.trim(), reportedBy: name.trim() || 'Anónimo' });
  };

  return (
    <Modal onClose={onClose}>
      <div className="bg-gradient-to-br from-surface-800 to-surface-900 rounded-2xl border border-surface-600/50 shadow-2xl overflow-hidden">
        <div className="relative px-6 pt-6 pb-4">
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg bg-surface-700/50 text-surface-400 hover:text-white hover:bg-surface-600 transition-all cursor-pointer">
            <IconClose />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center shadow-lg">
              <IconFound />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Objeto Encontrado</h2>
              <p className="text-sm text-surface-400">🟢 Pin Verde</p>
            </div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
          <div className="flex gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <div className="flex-shrink-0 mt-0.5"><IconShield /></div>
            <p className="text-amber-200/80 text-xs leading-relaxed">
              <strong>Reporte Ciego:</strong> No reveles detalles clave. El dueño legítimo deberá probar que es suyo describiéndolo.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">Describe vagamente el artículo *</label>
            <input type="text" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Ej: Dispositivo electrónico, prenda..." className="w-full px-4 py-3 rounded-xl bg-surface-700/50 border border-surface-600/50 text-white focus:outline-none focus:ring-2 focus:ring-green-500/50" required autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">Tu nombre (opcional)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-surface-700/50 border border-surface-600/50 text-white focus:outline-none focus:ring-2 focus:ring-green-500/50" />
          </div>
          <button type="submit" disabled={!item.trim()} className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-green-600 to-green-700 text-white font-semibold shadow-lg hover:from-green-500 hover:to-green-600 disabled:opacity-40 transition-all cursor-pointer">
            📌 Clavar Pin Verde
          </button>
        </form>
      </div>
    </Modal>
  );
}

/* ──────────────── Modal: Info del Pin + Candado Digital ──────────────── */
function PinInfoModal({ pin, onClose, onUnlock }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);
  const isLost = pin.type === 'lost';

  const handleUnlock = () => {
    if (code === pin.unlockCode) {
      setSuccess(true); setError(false);
      setTimeout(() => onUnlock(pin.id), 800);
    } else {
      setError(true); setCode('');
      setTimeout(() => setError(false), 600);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className={`bg-gradient-to-br from-surface-800 to-surface-900 rounded-2xl border shadow-2xl overflow-hidden ${success ? 'animate-success-pop' : ''} ${isLost ? 'border-red-500/30' : 'border-green-500/30'}`}>
        <div className="relative px-6 pt-6 pb-4">
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg bg-surface-700/50 text-surface-400 hover:text-white hover:bg-surface-600 cursor-pointer"><IconClose /></button>
          <div className="flex items-start gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${isLost ? 'bg-gradient-to-br from-red-500 to-red-700' : 'bg-gradient-to-br from-green-500 to-green-700'}`}>
              {isLost ? <IconLost /> : <IconFound />}
            </div>
            <div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${isLost ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                {isLost ? '🔴 PERDIDO' : '🟢 ENCONTRADO'}
              </span>
              <h2 className="text-white font-bold text-lg mt-1">{pin.item}</h2>
            </div>
          </div>
        </div>
        <div className="px-6 pb-4 space-y-3">
          {pin.description && <div className="p-3 rounded-xl bg-surface-700/30 border border-surface-600/30 text-surface-300 text-sm">{pin.description}</div>}
          <div className="flex justify-between text-xs text-surface-400">
            <span>👤 {pin.reportedBy}</span>
            <span>🕒 {formatTimestamp(pin.timestamp)}</span>
          </div>
        </div>
        <div className="mx-6 border-t border-surface-600/40" />
        <div className="px-6 pt-4 pb-6">
          <div className="flex items-center gap-2 mb-2"><IconLock /><h3 className="text-white font-semibold text-sm">Candado Digital</h3></div>
          <div className="flex gap-2">
            <div className={`flex-1 relative ${error ? 'animate-shake' : ''}`}>
              <input type="text" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && code.length === 4 && handleUnlock()} placeholder="• • • •" className={`w-full px-4 py-3 rounded-xl bg-surface-700/50 border text-white text-center text-xl tracking-[0.5em] font-mono focus:outline-none transition-all ${error ? 'border-red-500 bg-red-500/10' : success ? 'border-green-500 bg-green-500/10' : 'border-surface-600/50 focus:border-brand-500'}`} />
            </div>
            <button onClick={handleUnlock} disabled={code.length !== 4 || success} className={`px-5 py-3 rounded-xl font-semibold cursor-pointer ${success ? 'bg-green-600 text-white' : 'bg-gradient-to-r from-brand-500 to-brand-600 text-white disabled:opacity-40'}`}>{success ? '✓' : '🔓'}</button>
          </div>
          <p className="text-surface-600 text-[10px] mt-4 text-center italic">Código demo: {pin.unlockCode}</p>
        </div>
      </div>
    </Modal>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━ APP PRINCIPAL ━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function App() {
  const [pins, setPins] = useState(MOCK_PINS);
  const [modal, setModal] = useState(null);
  const [clickPos, setClickPos] = useState(null);
  const mapRef = useRef(null);

  const handleMapClick = useCallback((e) => {
    const rect = mapRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setClickPos({ x: parseFloat(x.toFixed(2)), y: parseFloat(y.toFixed(2)) });
    setModal('choose');
  }, []);

  const handlePinClick = useCallback((pin) => setModal({ type: 'info', pin }), []);
  const handleTypeSelect = useCallback((type) => setModal(type), []);

  const handleLostSubmit = useCallback(({ item, description, reportedBy }) => {
    setPins(prev => [...prev, { id: `pin-${Date.now()}`, type: 'lost', x: clickPos.x, y: clickPos.y, item, description, reportedBy, timestamp: new Date().toISOString(), unlockCode: generateUnlockCode() }]);
    setModal(null); setClickPos(null);
  }, [clickPos]);

  const handleFoundSubmit = useCallback(({ item, reportedBy }) => {
    setPins(prev => [...prev, { id: `pin-${Date.now()}`, type: 'found', x: clickPos.x, y: clickPos.y, item, description: 'Reporte ciego', reportedBy, timestamp: new Date().toISOString(), unlockCode: generateUnlockCode() }]);
    setModal(null); setClickPos(null);
  }, [clickPos]);

  const handleUnlock = useCallback((pinId) => {
    setPins(prev => prev.filter(p => p.id !== pinId));
    setModal(null);
  }, []);

  const closeModal = useCallback(() => { setModal(null); setClickPos(null); }, []);

  const lostCount = pins.filter(p => p.type === 'lost').length;
  const foundCount = pins.filter(p => p.type === 'found').length;

  return (
    <div className="min-h-screen bg-surface-900 text-white font-sans flex flex-col">
      <header className="sticky top-0 z-40 bg-surface-900/90 backdrop-blur-md border-b border-surface-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center"><IconPin /></div>
          <div><h1 className="font-bold text-brand-300">Objetos Perdidos</h1><p className="text-xs text-surface-400">Campus ITM</p></div>
        </div>
        <div className="flex gap-3 text-sm">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-red-300"><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> {lostCount} perdidos</div>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full text-green-300"><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> {foundCount} encontrados</div>
        </div>
      </header>

      <main className="flex-1 flex justify-center items-start p-4 md:p-6 w-full overflow-auto">
        <div 
          ref={mapRef} 
          onClick={handleMapClick}
          className="relative inline-block max-w-full border-2 border-surface-700 shadow-2xl rounded-xl overflow-hidden cursor-crosshair bg-surface-800"
        >
          {/* Aquí cargamos la imagen original como fondo en lugar del SVG dibujado */}
          <img 
            src="/mapa-itm.png" 
            alt="Plano Original del Campus ITM" 
            className="w-full h-auto max-h-[80vh] object-contain pointer-events-none block"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextElementSibling.style.display = 'flex';
            }}
          />
          {/* Fallback si la imagen no existe */}
          <div className="hidden absolute inset-0 bg-surface-800 flex-col items-center justify-center text-surface-400 p-8 text-center border-2 border-dashed border-surface-600 m-4 rounded-xl">
            <svg className="w-12 h-12 mb-4 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
            <p>Guarda tu imagen original como <strong className="text-white">mapa-itm.png</strong> dentro de la carpeta <strong className="text-white">public/</strong> de tu proyecto para que aparezca aquí.</p>
          </div>

          {pins.map((pin) => <MapPin key={pin.id} pin={pin} onClick={handlePinClick} />)}
          
          {clickPos && modal === 'choose' && (
            <div className="absolute z-20 w-6 h-6 -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ left: `${clickPos.x}%`, top: `${clickPos.y}%` }}>
              <div className="w-full h-full rounded-full border-2 border-brand-400 bg-brand-400/20 animate-ping" /><div className="absolute inset-1 rounded-full bg-brand-400" />
            </div>
          )}
        </div>
      </main>

      {modal === 'choose' && <PinTypeModal onClose={closeModal} onSelect={handleTypeSelect} />}
      {modal === 'lost' && <LostFormModal onClose={closeModal} onSubmit={handleLostSubmit} position={clickPos} />}
      {modal === 'found' && <FoundFormModal onClose={closeModal} onSubmit={handleFoundSubmit} position={clickPos} />}
      {modal?.type === 'info' && <PinInfoModal pin={modal.pin} onClose={closeModal} onUnlock={handleUnlock} />}
    </div>
  );
}
