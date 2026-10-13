/*
  The knew mark: the knewpeople crown at the four compass points. A pair of long
  strands straddles up, right, down and left, at ±16°, with one short strand on each
  diagonal. That makes twelve strands around a filled head. It is drawn in
  `currentColor`, so it follows the ink in both themes. The geometry is the mark
  pack's own (knew-mark-transparent-black.svg).
*/
const LONG = "M0 0 q4 -3 0 -7 q-4 -3.5 0 -7 q4 -3.5 0 -7";
const SHORT = "M0 0 q4 -3 0 -7 q-4 -3.5 0 -7";
const STRANDS = [-16, 16, 45, 74, 106, 135, 164, 196, 225, 254, 286, 315];

export function Mark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 160 160" aria-hidden="true" className={className}>
      <g transform="translate(-20,47.5) scale(1.25)">
        {STRANDS.map((angle) => (
          <path
            key={angle}
            transform={`rotate(${angle} 80 26) translate(80 -0.9) scale(1.25)`}
            d={angle % 90 === 45 ? SHORT : LONG}
            fill="none"
            stroke="currentColor"
            strokeWidth="6.875"
            strokeLinecap="round"
          />
        ))}
        <circle cx="80" cy="26" r="17.3" fill="currentColor" />
      </g>
    </svg>
  );
}
