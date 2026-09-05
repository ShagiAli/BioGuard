/**
 * A patient monitor on a pole above an infusion pump.
 *
 * Decoration for the sign-in panel, standing in for the photograph the
 * design puts there. Drawn rather than photographed, and drawn flat on
 * purpose: hand-authored SVG reaching for realism looks worse the harder
 * it tries, where a technical illustration at this size simply works.
 *
 * Generic on purpose too. The devices in the reference are identifiable
 * products; this is the same pair of machines in the same arrangement
 * with no maker's marks on either.
 *
 * The trace is the tell that this belongs to BioGuard rather than to a
 * stock library: the same stroke weight and rounded ends as the pulse
 * cut out of the mark.
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
      viewBox="0 0 300 430"
      className={className}
      style={style}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Pole, drawn first so both machines sit on top of it. */}
      <rect x="145" y="112" width="9" height="260" rx="4" className="fill-slate-300" />

      {/* ---------------------------------------------------- monitor */}
      <rect
        x="44"
        y="16"
        width="212"
        height="138"
        rx="12"
        className="fill-slate-100 stroke-slate-300"
        strokeWidth="2"
      />
      <rect x="57" y="29" width="186" height="102" rx="6" className="fill-slate-800" />

      {/* Mount joining the monitor to the pole. */}
      <rect x="133" y="152" width="34" height="13" rx="4" className="fill-slate-300" />

      {/* ECG: flat, a small p wave, the QRS spike, then a t wave. */}
      <path
        d="M69 88 h16 l5 -7 l5 7 h9 l4 11 l6 -35 l6 30 l4 -6 h10 l7 -9 l7 9 h14"
        className="stroke-brand-400"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* A second, quieter channel, as a real monitor carries. */}
      <path
        d="M69 116 q9 -11 18 0 t18 0 t18 0 t18 0"
        className="stroke-sky-400/50"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/*
       * Vitals, in three label-and-value pairs on an even rhythm. The
       * numbers are plausible rather than decorative — a resting adult,
       * breathing room air.
       */}
      <g fontFamily="ui-monospace, SFMono-Regular, monospace" textAnchor="end">
        {[
          { label: "HR", value: "72", y: 56, tone: "fill-brand-300" },
          { label: "SpO₂", value: "98", y: 88, tone: "fill-sky-300" },
          { label: "RR", value: "16", y: 120, tone: "fill-amber-300" },
        ].map((vital) => (
          <g key={vital.label}>
            <text x="232" y={vital.y - 15} fontSize="8" className="fill-slate-500">
              {vital.label}
            </text>
            <text x="232" y={vital.y} fontSize="21" fontWeight="600" className={vital.tone}>
              {vital.value}
            </text>
          </g>
        ))}
      </g>

      {/* ------------------------------------------------ infusion pump */}
      <rect
        x="84"
        y="192"
        width="130"
        height="126"
        rx="10"
        className="fill-slate-100 stroke-slate-300"
        strokeWidth="2"
      />
      <rect x="96" y="204" width="106" height="32" rx="5" className="fill-slate-800" />

      {/* Rate and volume, the two figures a pump actually shows. */}
      <g fontFamily="ui-monospace, SFMono-Regular, monospace">
        <text x="105" y="226" fontSize="14" fontWeight="600" className="fill-brand-300">
          125
        </text>
        <text x="139" y="226" fontSize="8" className="fill-slate-500">
          mL/h
        </text>
      </g>

      {/* Keypad. One key lit, so the machine reads as running. */}
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={99 + col * 36}
            y={248 + row * 22}
            width="30"
            height="16"
            rx="3"
            className={row === 2 && col === 1 ? "fill-brand-600" : "fill-slate-200"}
          />
        ))
      )}

      {/* Clamp joining the pump to the pole. */}
      <rect x="207" y="240" width="14" height="30" rx="4" className="fill-slate-300" />

      {/* --------------------------------------------------------- base */}
      <path
        d="M148 372 L108 400 M152 372 L192 400"
        className="stroke-slate-300"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <circle cx="104" cy="406" r="9" className="fill-slate-200 stroke-slate-400" strokeWidth="2" />
      <circle cx="196" cy="406" r="9" className="fill-slate-200 stroke-slate-400" strokeWidth="2" />
    </svg>
  );
}
