import React from 'react';

export default function CampusSVG() {
  return (
    <svg
      viewBox="0 0 1600 1000"
      className="w-full h-full"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Croquis del Campus ITM"
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#c8d5b9" strokeWidth="0.5" opacity="0.4" />
        </pattern>
        <linearGradient id="grassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d5e8ce" />
          <stop offset="100%" stopColor="#c2ddb6" />
        </linearGradient>
        <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
          <feDropShadow dx="3" dy="3" stdDeviation="3" floodColor="#000" floodOpacity="0.2" />
        </filter>
      </defs>

      {/* Fondo pasto */}
      <rect width="1600" height="1000" fill="url(#grassGrad)" />
      <rect width="1600" height="1000" fill="url(#grid)" />

      {/* Calles Principales */}
      {/* Calle Raza Maya (Arriba) */}
      <path d="M 150 100 L 1450 100" stroke="#e2e8f0" strokeWidth="50" strokeLinecap="square" />
      {/* Calle Primer Congreso (Izquierda) */}
      <path d="M 150 100 L 150 750" stroke="#e2e8f0" strokeWidth="50" strokeLinecap="square" />
      {/* Calle Heber Soto Fierro (Derecha) */}
      <path d="M 1450 100 L 1450 850" stroke="#e2e8f0" strokeWidth="50" strokeLinecap="square" />
      {/* Libramiento Norte (Abajo, inclinado) */}
      <path d="M 50 750 L 1550 950" stroke="#e2e8f0" strokeWidth="60" strokeLinecap="square" />
      {/* Av. Tecnologico (Diagonal) */}
      <path d="M 150 750 L 550 100" stroke="#e2e8f0" strokeWidth="45" strokeLinecap="square" />
      {/* Camino al posgrado */}
      <path d="M 1450 800 L 1250 910" stroke="#e2e8f0" strokeWidth="30" strokeLinecap="square" />

      {/* Lineas punteadas calles */}
      <path d="M 150 100 L 1450 100" stroke="#fff" strokeWidth="3" strokeDasharray="20,15" fill="none" />
      <path d="M 150 100 L 150 750" stroke="#fff" strokeWidth="3" strokeDasharray="20,15" fill="none" />
      <path d="M 1450 100 L 1450 850" stroke="#fff" strokeWidth="3" strokeDasharray="20,15" fill="none" />
      <path d="M 50 750 L 1550 950" stroke="#fff" strokeWidth="3" strokeDasharray="20,15" fill="none" />
      <path d="M 150 750 L 550 100" stroke="#fff" strokeWidth="3" strokeDasharray="20,15" fill="none" />

      {/* Nombres Calles */}
      <text x="800" y="65" textAnchor="middle" fill="#64748b" fontSize="18" fontWeight="800" letterSpacing="3">CALLE RAZA MAYA</text>
      <text x="90" y="400" textAnchor="middle" fill="#64748b" fontSize="16" fontWeight="800" letterSpacing="2" transform="rotate(-90, 90, 400)">CALLE PRIMER CONGRESO DE CONSTITUYENTES</text>
      <text x="1510" y="450" textAnchor="middle" fill="#64748b" fontSize="18" fontWeight="800" letterSpacing="2" transform="rotate(90, 1510, 450)">CALLE ING. HEBER SOTO FIERRO</text>
      <text x="800" y="900" textAnchor="middle" fill="#64748b" fontSize="20" fontWeight="800" letterSpacing="3" transform="rotate(7.5, 800, 900)">LIBRAMIENTO NORTE</text>
      <text x="310" y="450" textAnchor="middle" fill="#64748b" fontSize="16" fontWeight="800" letterSpacing="2" transform="rotate(-58.5, 310, 450)">AV. TECNOLÓGICO</text>

      {/* Andadores (Paths interiores) */}
      <path d="M 450 350 L 1100 350" stroke="#f1f5f9" strokeWidth="12" />
      <path d="M 400 550 L 1100 550" stroke="#f1f5f9" strokeWidth="12" />
      <path d="M 750 125 L 750 750" stroke="#f1f5f9" strokeWidth="12" />
      <path d="M 950 125 L 950 650" stroke="#f1f5f9" strokeWidth="12" />

      {/* Estacionamientos */}
      <rect x="250" y="130" width="160" height="40" fill="#cbd5e1" rx="4" stroke="#94a3b8" />
      <text x="330" y="155" textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="bold">ESTACIONAMIENTO 2</text>
      
      <rect x="850" y="130" width="300" height="40" fill="#cbd5e1" rx="4" stroke="#94a3b8" />
      <text x="1000" y="155" textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="bold">ESTACIONAMIENTO 5</text>
      
      <g transform="rotate(5, 550, 770)">
        <rect x="550" y="770" width="250" height="50" fill="#cbd5e1" rx="4" stroke="#94a3b8" />
        <text x="675" y="800" textAnchor="middle" fill="#64748b" fontSize="14" fontWeight="bold">ESTACIONAMIENTO 4</text>
      </g>

      <g transform="rotate(15, 1350, 850)">
        <rect x="1350" y="850" width="100" height="40" fill="#cbd5e1" rx="4" stroke="#94a3b8" />
        <text x="1400" y="875" textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="bold">ESTAC. 3</text>
      </g>

      {/* Titulos de Zonas */}
      <text x="250" y="210" textAnchor="middle" fill="#334155" fontSize="20" fontWeight="800" letterSpacing="1">UNIDAD METAL MECÁNICA</text>
      <text x="900" y="210" textAnchor="middle" fill="#334155" fontSize="24" fontWeight="800" letterSpacing="2">UNIDAD CENTRAL</text>
      <text x="1330" y="700" textAnchor="middle" fill="#334155" fontSize="20" fontWeight="800" letterSpacing="1">UNIDAD POSGRADO</text>
      <text x="1330" y="725" textAnchor="middle" fill="#334155" fontSize="20" fontWeight="800" letterSpacing="1">EN ELÉCTRICA</text>

      {/* ================= EDIFICIOS ================= */}
      <g filter="url(#shadow)">
        {/* --- UNIDAD METAL MECÁNICA --- */}
        {/* Usamos un color naranja cálido para los edificios como el mapa original */}
        
        {/* 2K (Top horizontal) */}
        <rect x="180" y="240" width="140" height="40" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="250" y="265" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">2K</text>
        
        {/* 2J, 2H, 2G, 2F */}
        <rect x="180" y="295" width="40" height="30" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="200" y="315" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">2J</text>
        <rect x="180" y="340" width="50" height="35" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="205" y="365" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">2H</text>
        
        <rect x="250" y="295" width="45" height="80" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="272.5" y="340" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">2G</text>
        
        <rect x="315" y="295" width="45" height="40" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="337.5" y="322" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">2F</text>
        <rect x="315" y="350" width="45" height="40" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="337.5" y="377" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">2E</text>

        {/* 2D, 2C, 2B */}
        <rect x="190" y="400" width="90" height="40" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="235" y="425" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">2D</text>
        <rect x="200" y="460" width="40" height="35" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="220" y="482" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">2C</text>
        <rect x="255" y="460" width="40" height="35" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="275" y="482" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">2B</text>

        {/* 2A - H shape */}
        <path d="M 180 520 L 260 520 L 260 550 L 230 550 L 230 570 L 260 570 L 260 600 L 180 600 L 180 570 L 210 570 L 210 550 L 180 550 Z" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" />
        <text x="220" y="565" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">2A</text>


        {/* --- UNIDAD CENTRAL --- */}
        {/* Fila Arriba: CH, AG, B, C */}
        <rect x="700" y="240" width="130" height="70" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="765" y="280" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="bold">CH</text>
        
        <rect x="920" y="240" width="60" height="90" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="950" y="290" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold">AG</text>
        
        <rect x="680" y="330" width="55" height="35" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="707.5" y="354" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">B</text>
        <rect x="750" y="330" width="90" height="35" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="795" y="354" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">C</text>

        <rect x="750" y="380" width="90" height="50" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="795" y="410" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">D</text>

        {/* Fila Media 1: A, E, F, G, H */}
        <rect x="580" y="370" width="90" height="80" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="625" y="415" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="bold">A</text>

        <rect x="690" y="460" width="80" height="40" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="730" y="485" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">E</text>
        
        <rect x="650" y="520" width="70" height="40" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="685" y="545" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">F</text>

        <rect x="740" y="500" width="90" height="110" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="785" y="560" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="bold">G</text>
        <rect x="850" y="500" width="60" height="110" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="880" y="560" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="bold">H</text>

        <rect x="840" y="440" width="50" height="40" fill="#cbd5e1" rx="2" stroke="#94a3b8" strokeWidth="1.5" />
        <text x="865" y="465" textAnchor="middle" fill="#64748b" fontSize="14" fontWeight="bold">S3</text>

        {/* Fila Media 2: I, J, K, L */}
        <rect x="560" y="560" width="130" height="80" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="625" y="605" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="bold">I</text>

        <rect x="490" y="570" width="50" height="50" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="515" y="600" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">J</text>

        <rect x="560" y="660" width="160" height="40" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="640" y="685" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">K</text>

        <path d="M 400 620 L 520 620 L 520 655 L 440 655 L 440 710 L 400 710 Z" fill="#fb923c" stroke="#b45309" strokeWidth="1.5" />
        <text x="460" y="643" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold">L</text>

        {/* Fila Inferior 1: M, N, Ñ, O, P, LL */}
        <rect x="380" y="730" width="70" height="80" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="415" y="775" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold">M</text>
        <rect x="460" y="730" width="70" height="80" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="495" y="775" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold">N</text>

        <rect x="550" y="715" width="45" height="40" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="572.5" y="740" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">Ñ</text>
        <rect x="605" y="715" width="65" height="40" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="637.5" y="740" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">O</text>
        <rect x="680" y="715" width="45" height="40" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="702.5" y="740" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">P</text>
        <rect x="580" y="765" width="70" height="60" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="615" y="800" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">LL</text>

        {/* Fila Inferior 2: R, S, T, U */}
        <rect x="680" y="790" width="50" height="45" fill="#ef4444" rx="2" stroke="#b91c1c" strokeWidth="1.5" />
        <text x="705" y="818" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">R</text>

        <path d="M 400 830 L 500 830 L 500 855 L 400 855 Z" fill="#fb923c" stroke="#b45309" strokeWidth="1.5" />
        <text x="450" y="848" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">S</text>
        <rect x="450" y="865" width="40" height="25" fill="#cbd5e1" rx="2" stroke="#94a3b8" />
        <text x="470" y="882" textAnchor="middle" fill="#64748b" fontSize="12" fontWeight="bold">S2</text>
        <rect x="520" y="855" width="40" height="35" fill="#cbd5e1" rx="2" stroke="#94a3b8" />
        <text x="540" y="878" textAnchor="middle" fill="#64748b" fontSize="14" fontWeight="bold">S1</text>

        <rect x="570" y="840" width="90" height="70" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="615" y="880" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="bold">T</text>
        <rect x="680" y="840" width="140" height="100" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="750" y="895" textAnchor="middle" fill="#fff" fontSize="26" fontWeight="bold">U</text>

        {/* Zona Derecha: Q, W, V, Z, Y, AA, AE, AF */}
        <rect x="930" y="660" width="90" height="50" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="975" y="690" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold">Q</text>
        
        <rect x="800" y="730" width="40" height="50" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="820" y="760" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">W</text>
        <rect x="850" y="740" width="40" height="40" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="870" y="765" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">V</text>
        <rect x="900" y="730" width="60" height="60" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="930" y="765" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">Z</text>
        <rect x="860" y="805" width="60" height="40" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="890" y="830" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">X</text>

        <rect x="980" y="730" width="60" height="60" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="1010" y="765" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">Y</text>
        <rect x="1050" y="660" width="60" height="60" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="1080" y="695" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">AA</text>
        
        <rect x="1060" y="730" width="70" height="90" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="1095" y="780" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold">AE</text>
        
        <rect x="1150" y="730" width="120" height="110" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="1210" y="790" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="bold">AF</text>

        {/* AB, AC, AD, AH */}
        <rect x="940" y="810" width="50" height="40" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="965" y="835" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">AB</text>
        <rect x="900" y="860" width="70" height="30" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="935" y="880" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">AC</text>
        <rect x="900" y="900" width="70" height="30" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="935" y="920" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">AD</text>

        <rect x="1000" y="860" width="80" height="60" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
        <text x="1040" y="895" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold">AH</text>

        {/* --- POSGRADO ELÉCTRICA --- */}
        <g transform="rotate(15, 1300, 800)">
          <rect x="1230" y="770" width="100" height="70" fill="#fb923c" rx="2" stroke="#b45309" strokeWidth="1.5" />
          <text x="1280" y="812" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold">3B</text>
          <rect x="1190" y="855" width="80" height="60" fill="#f59e0b" rx="2" stroke="#b45309" strokeWidth="1.5" />
          <text x="1230" y="892" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">3A</text>
        </g>
      </g>

      {/* Pista de Atletismo */}
      <g transform="translate(1260, 430)">
        {/* Exterior track */}
        <rect x="-180" y="-250" width="360" height="500" rx="180" fill="#d97706" opacity="0.85" stroke="#b45309" strokeWidth="6" />
        {/* Interior field */}
        <rect x="-150" y="-220" width="300" height="440" rx="150" fill="#4ade80" opacity="0.7" />
        {/* Track lines */}
        <rect x="-165" y="-235" width="330" height="470" rx="165" fill="none" stroke="#fcd34d" strokeWidth="2" opacity="0.6" />
        <rect x="-157.5" y="-227.5" width="315" height="455" rx="157.5" fill="none" stroke="#fcd34d" strokeWidth="2" opacity="0.6" />
        {/* Soccer field */}
        <rect x="-90" y="-160" width="180" height="320" fill="none" stroke="#fff" strokeWidth="3" opacity="0.8" />
        <line x1="-90" y1="0" x2="90" y2="0" stroke="#fff" strokeWidth="3" opacity="0.8" />
        <circle cx="0" cy="0" r="35" fill="none" stroke="#fff" strokeWidth="3" opacity="0.8" />
        
        <text x="0" y="275" textAnchor="middle" fill="#334155" fontSize="14" fontWeight="800">PISTA DE ATLETISMO</text>
      </g>

      {/* Árboles Decorativos */}
      {[
        [200, 650], [260, 700], [380, 520], [480, 480], [550, 220], [630, 280], [750, 140],
        [900, 280], [1050, 280], [1200, 160], [1300, 130], [1480, 650], [1150, 650],
        [1200, 900], [1100, 900], [850, 950], [420, 900], [320, 800], [280, 900],
        [50, 500], [80, 600], [1400, 300], [1450, 400], [130, 800], [900, 150]
      ].map(([cx, cy], i) => (
        <circle key={`tree-${i}`} cx={cx} cy={cy} r={12 + (i % 3) * 4} fill="#4ade80" opacity={0.65} />
      ))}

      {/* Brujula */}
      <g transform="translate(1500, 150)">
        <circle cx="0" cy="0" r="35" fill="#1e293b" opacity="0.9" />
        <text x="0" y="-12" textAnchor="middle" fill="#f59e0b" fontSize="22" fontWeight="800">N</text>
        <polygon points="0,-30 -10,-12 10,-12" fill="#f59e0b" />
        <polygon points="0,30 -10,-12 10,-12" fill="#94a3b8" opacity="0.5" />
      </g>
    </svg>
  );
}
