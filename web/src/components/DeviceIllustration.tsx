/**
 * A patient monitor on a pole above an infusion pump.
 *
 * Stands in for the photograph the design puts in the sign-in panel.
 * Drawn with a single light source from the top left: every body panel
 * carries a gradient, every recess a darker edge, so the plastic reads
 * as moulded rather than as flat shapes.
 *
 * Generic on purpose. The devices in the reference are identifiable
 * products; this is the same pair of machines in the same arrangement
 * with no maker's marks on either.
 *
 * The screen keeps clinical colours rather than brand ones — green ECG,
 * cyan saturation, amber respiration — because that is what these
 * machines actually look like, and a monitor recoloured to match a
 * palette stops reading as a monitor.
 */
export function DeviceIllustration({
  className = "",
  style,
}: {
  className?: string;
  /** Carries the mask that fades the drawing into the panel behind it. */
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 340 520"
      className={className}
      style={style}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Light from the top left, so every panel is lit the same way. */}
        <linearGradient id="dev-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#eef2f6" />
          <stop offset="100%" stopColor="#d3dbe4" />
        </linearGradient>
        <linearGradient id="dev-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#c3ccd7" />
          <stop offset="100%" stopColor="#9aa6b4" />
        </linearGradient>
        {/* A pole is a cylinder: bright down one side, dark down the other. */}
        <linearGradient id="dev-pole" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="35%" stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#8f9caa" />
        </linearGradient>
        <linearGradient id="dev-screen" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#111d2e" />
          <stop offset="100%" stopColor="#060c16" />
        </linearGradient>
        <linearGradient id="dev-knob" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#aab6c4" />
        </linearGradient>
        {/* The glass catches the light across one corner. */}
        <linearGradient id="dev-glare" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="dev-shadow">
          <stop offset="0%" stopColor="#0f172a" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Contact shadow, so the stand sits on something. */}
      <ellipse cx="170" cy="497" rx="104" ry="14" fill="url(#dev-shadow)" />

      {/* Pole, behind everything it carries. */}
      <rect x="162" y="150" width="12" height="330" rx="6" fill="url(#dev-pole)" />

      {/* ------------------------------------------------------ monitor */}
      {/* The case has depth: a darker slab behind the face. */}
      <rect x="52" y="30" width="228" height="164" rx="12" fill="url(#dev-side)" />
      <rect
        x="44"
        y="22"
        width="228"
        height="164"
        rx="12"
        fill="url(#dev-body)"
        stroke="#c2ccd8"
        strokeWidth="1.5"
      />

      {/* Screen, recessed behind a dark bezel. */}
      <rect x="56" y="34" width="172" height="122" rx="5" fill="#243244" />
      <rect x="60" y="38" width="164" height="114" rx="3" fill="url(#dev-screen)" />

      {/* Faint graticule, as these screens carry. */}
      <g stroke="#1e3a5f" strokeWidth="0.5" opacity="0.55">
        <path d="M60 66 H224 M60 94 H224 M60 122 H224" />
      </g>

      {/* ECG. Flat, a small p wave, the QRS spike, a t wave, and repeat. */}
      <path
        d="M66 62 h14 l4 -6 l4 6 h8 l3 8 l5 -26 l5 22 l3 -4 h9 l5 -7 l5 7 h12
           l4 -6 l4 6 h8 l3 8 l5 -26 l5 22 l3 -4 h9"
        stroke="#4ade80"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Pleth: the rounded, lagging wave a saturation probe draws. */}
      <path
        d="M66 100 q6 -14 12 -2 t9 4 q7 -16 13 -3 t9 5 q7 -16 13 -3 t9 5 q7 -16 13 -3 t9 5"
        stroke="#22d3ee"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* Respiration: slower and shallower than the two above it. */}
      <path
        d="M66 136 q14 -12 28 0 t28 0 t28 0 t28 0"
        stroke="#fbbf24"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* Readouts. Plausible for a resting adult breathing room air. */}
      <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" textAnchor="end">
        <text x="218" y="52" fontSize="7" fill="#4ade80" opacity="0.75">
          HR bpm
        </text>
        <text x="218" y="74" fontSize="24" fontWeight="700" fill="#4ade80">
          72
        </text>
        <text x="218" y="88" fontSize="7" fill="#22d3ee" opacity="0.75">
          SpO₂ %
        </text>
        <text x="218" y="108" fontSize="21" fontWeight="700" fill="#22d3ee">
          98
        </text>
        <text x="218" y="122" fontSize="7" fill="#fbbf24" opacity="0.75">
          RR
        </text>
        <text x="218" y="141" fontSize="18" fontWeight="700" fill="#fbbf24">
          16
        </text>
      </g>

      {/* Glass, catching the light across the top-left corner. */}
      <rect x="60" y="38" width="164" height="114" rx="3" fill="url(#dev-glare)" />

      {/* Controls down the right cheek: a rotary and three keys. */}
      <circle cx="250" cy="60" r="14" fill="url(#dev-knob)" stroke="#b3bece" strokeWidth="1.5" />
      <circle cx="250" cy="60" r="6" fill="#cbd5e1" />
      <rect x="240" y="88" width="20" height="9" rx="3" fill="#dde3ea" stroke="#c2ccd8" />
      <rect x="240" y="103" width="20" height="9" rx="3" fill="#dde3ea" stroke="#c2ccd8" />
      <rect x="240" y="118" width="20" height="9" rx="3" fill="#4ade80" opacity="0.85" />

      {/* Soft keys under the screen, and a vent. */}
      <g fill="#dde3ea" stroke="#c7d0db" strokeWidth="1">
        <rect x="62" y="164" width="26" height="12" rx="3" />
        <rect x="94" y="164" width="26" height="12" rx="3" />
        <rect x="126" y="164" width="26" height="12" rx="3" />
        <rect x="158" y="164" width="26" height="12" rx="3" />
      </g>
      <g stroke="#c7d0db" strokeWidth="1.5" strokeLinecap="round">
        <path d="M196 168 h22 M196 172 h22" />
      </g>

      {/* Mount joining the monitor to the pole. */}
      <rect x="152" y="186" width="32" height="16" rx="4" fill="url(#dev-side)" />
      <rect x="156" y="186" width="24" height="16" rx="4" fill="url(#dev-body)" />

      {/* ------------------------------------------------- infusion pump */}
      <rect x="98" y="248" width="150" height="152" rx="12" fill="url(#dev-side)" />
      <rect
        x="90"
        y="240"
        width="150"
        height="152"
        rx="12"
        fill="url(#dev-body)"
        stroke="#c2ccd8"
        strokeWidth="1.5"
      />

      {/* Rate display. */}
      <rect x="100" y="250" width="130" height="38" rx="4" fill="#243244" />
      <rect x="103" y="253" width="124" height="32" rx="3" fill="url(#dev-screen)" />
      <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
        <text x="110" y="270" fontSize="7" fill="#94a3b8">
          RATE
        </text>
        <text x="110" y="281" fontSize="13" fontWeight="700" fill="#4ade80">
          125
        </text>
        <text x="140" y="281" fontSize="7" fill="#64748b">
          mL/h
        </text>
        <text x="196" y="270" fontSize="7" fill="#94a3b8">
          VTBI
        </text>
        <text x="196" y="281" fontSize="10" fontWeight="600" fill="#22d3ee">
          250
        </text>
      </g>

      {/* The cassette door, recessed with a handle down its edge. */}
      <rect x="100" y="296" width="52" height="84" rx="6" fill="#dfe5ec" stroke="#c2ccd8" />
      <rect x="106" y="302" width="40" height="72" rx="4" fill="#eef2f6" stroke="#cfd8e2" />
      <rect x="140" y="326" width="4" height="24" rx="2" fill="#b3bece" />
      {/* Running, and saying so. */}
      <circle cx="112" cy="312" r="3.5" fill="#4ade80" />

      {/* Keypad. Green starts it, red stops it, as they always do. */}
      <g stroke="#c2ccd8" strokeWidth="1">
        {[0, 1, 2].map((row) =>
          [0, 1].map((col) => (
            <rect
              key={`k-${row}-${col}`}
              x={164 + col * 34}
              y={298 + row * 24}
              width="28"
              height="18"
              rx="4"
              fill="#e6ebf1"
            />
          ))
        )}
      </g>
      <rect x="164" y="370" width="28" height="18" rx="4" fill="#22c55e" />
      <rect x="198" y="370" width="28" height="18" rx="4" fill="#ef4444" />

      {/* Clamp holding the pump to the pole. */}
      <rect x="236" y="300" width="16" height="40" rx="5" fill="url(#dev-side)" />
      <rect x="238" y="302" width="12" height="36" rx="4" fill="url(#dev-body)" />

      {/* Giving set, leaving the pump and dropping out of frame. */}
      <path
        d="M126 380 q-4 30 8 48 t2 40"
        stroke="#cbd5e1"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.8"
      />

      {/* ---------------------------------------------------------- base */}
      <ellipse cx="168" cy="474" rx="22" ry="8" fill="url(#dev-side)" />
      {/* Five legs, foreshortened, so the base sits in perspective. */}
      <g stroke="url(#dev-pole)" strokeWidth="9" strokeLinecap="round">
        <path d="M168 476 L106 470" />
        <path d="M168 476 L230 470" />
        <path d="M168 478 L134 492" />
        <path d="M168 478 L202 492" />
      </g>
      <g fill="#94a3b8">
        <ellipse cx="102" cy="471" rx="8" ry="6" />
        <ellipse cx="234" cy="471" rx="8" ry="6" />
        <ellipse cx="130" cy="494" rx="8" ry="6" />
        <ellipse cx="206" cy="494" rx="8" ry="6" />
      </g>
    </svg>
  );
}
