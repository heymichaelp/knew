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

/*
  With `shimmer`, the strands catch the light one at a time, in no order: each one dims
  softly and comes back (`.shimmer` in globals.css). Each strand has its own start and
  a slightly different length, so the order keeps changing and never settles into a
  pattern. The values are fixed, not random, so the server and the browser draw the same
  thing. The hero's mark only: everywhere else the mark holds still.
*/
const SHIMMER = [
  [3.5, 2.1], [3.9, 0.6], [3.3, 3.0], [3.7, 1.2], [3.4, 0.0], [4.0, 2.6],
  [3.6, 1.7], [3.2, 0.9], [3.8, 3.3], [3.5, 0.3], [3.3, 2.3], [3.9, 1.5],
] as const;

/** When the shimmer starts: once the hero's mark has settled to its size. */
const SETTLED = 2.4;

export function Mark({ className, shimmer = false }: { readonly className?: string; readonly shimmer?: boolean }) {
  return (
    <svg viewBox="0 0 160 160" aria-hidden="true" className={className}>
      <g transform="translate(-20,47.5) scale(1.25)">
        {STRANDS.map((angle, index) => (
          <path
            key={angle}
            className={shimmer ? "shimmer" : undefined}
            style={
              shimmer
                ? { animationDuration: `${SHIMMER.at(index)![0]}s`, animationDelay: `${SETTLED + SHIMMER.at(index)![1]}s` }
                : undefined
            }
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
