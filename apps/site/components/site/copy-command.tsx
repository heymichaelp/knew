"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** A shell command in a code block, with a button that copies it. */
export function CopyCommand({ command }: { readonly command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard (an insecure origin, or permission refused): the command is still there to select.
    }
  };

  return (
    <div className="flex max-w-full items-center gap-3 rounded-lg border border-rule bg-paper-sunken py-2 pr-2 pl-4 text-left">
      <pre className="code min-w-0 overflow-x-auto text-[0.9375rem]">
        <span className="text-ink-faint select-none">$ </span>
        {command}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy the command"}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-paper hover:text-ink"
      >
        {copied ? <Check className="size-4 text-stamp" strokeWidth={2} /> : <Copy className="size-4" strokeWidth={2} />}
      </button>
    </div>
  );
}
