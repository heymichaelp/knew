/*
  The name, set in the display face with its k upside down: the stem hangs below the
  line like a descender, and the arms sit on the x-height beside "new". The offsets
  are in em, so they scale, and were tuned by eye on an iPhone at the opening's size.
  At the small sizes (the headers, the drawer, the footer) the k sat a pixel high, so
  `small` drops it one pixel more. The text is still "knew", for copying and for screen
  readers.
*/
export function Wordmark({ className = "", small = false }: { readonly className?: string; readonly small?: boolean }) {
  const drop = small ? "translate-y-[calc(0.084em+1px)]" : "translate-y-[0.084em]";
  return (
    <span className={`display ${className}`}>
      <span className={`mr-[0.05em] inline-block translate-x-[0.04em] ${drop} -scale-y-100`}>k</span>new
    </span>
  );
}
