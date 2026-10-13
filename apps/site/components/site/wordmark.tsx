/*
  The name, drawn: "knew" in Passion One with its k upside down, the stem hanging below the
  line like a descender and the arms on the x-height beside "new".

  It is outlines, not text, so the k and "new" are one drawing and cannot drift apart. Set
  as text, the flipped k is a box of its own, and the browser rounds that box to whole
  pixels differently at each size and screen: the k sat a pixel or two off "new" in the
  header while the opening looked right.

  The outlines are Passion One 400's (SIL Open Font License), in em, y down, baseline at 0;
  "new" is laid out with the font's advances and kerning after the k's advance and a
  0.05em gap. The k is flipped the way CSS flipped it, about the middle of its box, which
  sits (ascent − descent) / 2 above the baseline, then moved 0.04em right and 0.084em down:
  the offsets tuned by eye on an iPhone at the opening's size.

  The box the drawing reports is the x-height band of "new" alone — from the baseline up to
  the top of the small letters — and the ascent and the k's hanging stem overflow it. That
  way whatever centres on the name, the mark beside it in the header and the footer, centres
  on the letters of "new", and the stem falls below the centre the way a descender would.
  The bottom edge is the baseline, so inline it sits where text would.
*/
const ASCENT = 0.835;
const DESCENT = 0.266;
const WIDTH = 1.979;
/** The x-height: the top of "new" above the baseline. */
const X_HEIGHT = 0.491;
/** The middle of the k's box: (ascent − descent) / 2 above the baseline. */
const AXIS = -(ASCENT - DESCENT) / 2;
const K_OFFSET = { x: 0.04, y: 0.084 };

const K = "M0.346 -0.24L0.443 0L0.258 0L0.197 -0.184L0.193 -0.184L0.193 0L0.03 0L0.03 -0.641L0.195 -0.641L0.195 -0.288L0.199 -0.288L0.272 -0.479L0.447 -0.479L0.346 -0.24Z";
const NEW = "M0.685 -0.444L0.689 -0.444Q0.744 -0.491 0.81 -0.491Q0.876 -0.491 0.9025 -0.4605Q0.929 -0.43 0.929 -0.369L0.929 -0.369L0.929 0L0.759 0L0.759 -0.312Q0.759 -0.337 0.737 -0.337L0.737 -0.337Q0.709 -0.337 0.69 -0.323L0.69 -0.323L0.69 0L0.522 0L0.522 -0.479L0.675 -0.479L0.685 -0.444ZM1.189 -0.348L1.189 -0.348Q1.163 -0.348 1.155 -0.3305Q1.147 -0.313 1.147 -0.277L1.147 -0.277L1.234 -0.277L1.234 -0.301Q1.234 -0.348 1.189 -0.348ZM1.193 -0.491L1.193 -0.491Q1.296 -0.491 1.3405 -0.4415Q1.385 -0.392 1.385 -0.3L1.385 -0.3Q1.385 -0.288 1.378 -0.192L1.378 -0.192L1.15 -0.192Q1.15 -0.117 1.219 -0.117L1.219 -0.117Q1.252 -0.117 1.348 -0.14L1.348 -0.14L1.362 -0.016Q1.278 0.01 1.194 0.01L1.194 0.01Q1.091 0.01 1.036 -0.0575Q0.981 -0.125 0.981 -0.241L0.981 -0.241Q0.981 -0.491 1.193 -0.491ZM1.826 -0.479L1.974 -0.479L1.913 0L1.73 0L1.691 -0.202L1.684 -0.202L1.646 0L1.467 0L1.406 -0.479L1.56 -0.479L1.581 -0.237L1.589 -0.237L1.623 -0.479L1.762 -0.479L1.795 -0.237L1.804 -0.237L1.826 -0.479Z";

export function Wordmark({ className = "" }: { readonly className?: string }) {
  return (
    <span className={`inline-flex ${className}`}>
      <svg
        role="img"
        aria-label="knew"
        viewBox={`0 ${-X_HEIGHT} ${WIDTH} ${X_HEIGHT}`}
        fill="currentColor"
        className="overflow-visible"
        style={{ width: `${WIDTH}em`, height: `${X_HEIGHT}em` }}
      >
        <path d={K} transform={`translate(${K_OFFSET.x} ${2 * AXIS + K_OFFSET.y}) scale(1 -1)`} />
        <path d={NEW} />
      </svg>
    </span>
  );
}
