/*
  The name, set in the display face with its k upside down: the stem hangs below the
  line like a descender, and the arms sit on the x-height beside "new". The offsets
  are in em, so it holds at every size; they were tuned by eye on an iPhone. The
  text is still "knew", for copying and for screen readers.
*/
export function Wordmark({ className = "" }: { readonly className?: string }) {
  return (
    <span className={`display ${className}`}>
      <span className="mr-[0.05em] inline-block translate-x-[0.04em] translate-y-[0.084em] -scale-y-100">k</span>new
    </span>
  );
}
