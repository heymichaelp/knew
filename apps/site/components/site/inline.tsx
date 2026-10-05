import { Fragment, type ReactNode } from "react";

/**
 * Renders `backticked` spans in a plain string as inline code. The notes beside
 * the lens fields are prose, not markdown documents — this is all the markup
 * they need, and it keeps them readable in the source file.
 */
export function Inline({ text }: { readonly text: string }): ReactNode {
  return text.split(/`([^`]+)`/g).map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="code text-[0.875em] text-derived">
        {part}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
