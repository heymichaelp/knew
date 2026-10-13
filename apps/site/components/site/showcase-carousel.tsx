"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";

import type { Scenario } from "@/lib/showcase";

/**
 * One small program at a time, chosen by name or stepped through, each line that
 * produces something followed by what it produced. Every panel is
 * rendered in the same grid cell and only the chosen one is visible, so the
 * carousel is as tall as its longest program and nothing below it jumps.
 */
export function ShowcaseCarousel({ scenarios }: { readonly scenarios: readonly Scenario[] }) {
  const [current, setCurrent] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const go = (index: number, focus = false) => {
    const next = (index + scenarios.length) % scenarios.length;
    setCurrent(next);
    const tab = tabs.current[next];
    tab?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    if (focus) tab?.focus();
  };

  return (
    <div className="min-w-0">
      <div className="flex items-start gap-3">
        <div
          role="tablist"
          aria-label="Examples"
          className="-ml-6 flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5 pl-6 [scrollbar-width:none] sm:ml-0 sm:flex-wrap sm:pl-0"
        >
          {scenarios.map((scenario, index) => (
            <button
              key={scenario.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`showcase-tab-${scenario.id}`}
              aria-selected={index === current}
              aria-controls={`showcase-panel-${scenario.id}`}
              tabIndex={index === current ? 0 : -1}
              onClick={() => go(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") go(index + 1, true);
                else if (event.key === "ArrowLeft") go(index - 1, true);
                else if (event.key === "Home") go(0, true);
                else if (event.key === "End") go(scenarios.length - 1, true);
                else return;
                event.preventDefault();
              }}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-sm whitespace-nowrap transition-colors ${
                index === current
                  ? "border-ink bg-ink text-paper"
                  : "border-rule-strong text-ink-soft hover:border-ink hover:text-ink"
              }`}
            >
              {scenario.title}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-sm whitespace-nowrap text-ink-faint sm:inline" aria-live="polite">
            {current + 1} of {scenarios.length}
          </span>
          <button
            type="button"
            onClick={() => go(current - 1)}
            aria-label="Previous example"
            className="flex size-10 items-center justify-center rounded-full border border-rule-strong text-ink transition-colors hover:border-ink"
          >
            <ChevronLeft className="size-5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => go(current + 1)}
            aria-label="Next example"
            className="flex size-10 items-center justify-center rounded-full border border-rule-strong text-ink transition-colors hover:border-ink"
          >
            <ChevronRight className="size-5" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="mt-5 grid">
        {scenarios.map((scenario, index) => (
          <div
            key={scenario.id}
            role="tabpanel"
            id={`showcase-panel-${scenario.id}`}
            aria-labelledby={`showcase-tab-${scenario.id}`}
            className={`min-w-0 [grid-area:1/1] transition-[opacity,visibility] duration-200 ${
              index === current ? "visible opacity-100" : "invisible opacity-0"
            }`}
          >
            <p className="max-w-2xl text-ink-soft">{scenario.blurb}</p>
            <pre className="code mt-4 overflow-x-auto border border-rule border-l-2 border-l-stamp bg-paper-sunken p-5 text-[0.8125rem] leading-relaxed">
              {scenario.segments.map((segment, at) =>
                segment.kind === "code" ? (
                  <span key={at} className={segment.spaced ? "mt-5 block" : "block"}>
                    {segment.tokens.map((token, part) =>
                      token.kind === "plain" ? (
                        token.text
                      ) : (
                        <span key={part} className={token.kind === "comment" ? "text-ink-faint italic" : "text-ink-soft"}>
                          {token.text}
                        </span>
                      ),
                    )}
                  </span>
                ) : (
                  <span key={at} className="my-2 block w-max min-w-full border-l-2 border-rule-strong bg-paper py-2 pr-4 pl-3">
                    {segment.text}
                  </span>
                ),
              )}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
