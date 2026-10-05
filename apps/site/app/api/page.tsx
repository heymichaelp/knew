import type { Metadata } from "next";

import { DocBody, DocHeader } from "@/components/site/page-shell";
import { ALL_ROUTES, ROUTE_GROUPS } from "@/lib/api-routes";
import { clientMethods, SUBJECT_HEADER } from "@/lib/engine";
import { DEFAULT_TIMEOUTS } from "@popjoker/knew";

export const metadata: Metadata = {
  title: "The API",
  description: "Every route, the envelope, the two headers, and the stateless request and answer shapes.",
};

const HEADINGS = [
  { id: "the-two-headers", text: "The two headers", level: 2 },
  { id: "the-envelope", text: "The envelope", level: 2 },
  { id: "the-routes", text: "The routes", level: 2 },
  { id: "timeouts", text: "Timeouts", level: 2 },
];

export default function ApiPage() {
  const methods = clientMethods();

  return (
    <>
      <DocHeader
        clause="The API"
        title="One door, and a scope on every call."
        standfirst="The hosted service is a thin skin over the contract: a route per method, the same envelope on every answer, and two headers that decide who is asking and about whom. The client in the package speaks all of it, so most adopters never write a request by hand."
        aside={
          <p className="stamp">
            <span>{ALL_ROUTES.length} routes</span>
            <span aria-hidden>·</span>
            <span>{methods.length} client methods</span>
          </p>
        }
      />

      <DocBody headings={HEADINGS}>
        <section id="the-two-headers">
          <p className="clause">01</p>
          <h2 className="display mt-2 text-3xl">The two headers</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="card p-6">
              <p className="code text-sm text-stamp">authorization</p>
              <p className="mt-2 code text-[0.8125rem] text-ink-faint">
                Bearer &lt;serviceKey&gt;
              </p>
              <p className="mt-4 text-[0.9375rem] text-ink-soft">
                Identifies the client. The key is minted per client with the service’s CLI and decides which lens the
                request reads through. A client never sees another client’s rows.
              </p>
            </div>
            <div className="card p-6">
              <p className="code text-sm text-stamp">{SUBJECT_HEADER}</p>
              <p className="mt-2 code text-[0.8125rem] text-ink-faint">
                &lt;subjectId&gt;
              </p>
              <p className="mt-4 text-[0.9375rem] text-ink-soft">
                Identifies whose ledger it is. A subject id means nothing outside the client that sent it. Every row a
                subject touches carries both ids, and every query puts both in its WHERE.
              </p>
            </div>
          </div>
        </section>

        <section id="the-envelope" className="rule-t mt-14 pt-10">
          <p className="clause">02</p>
          <h2 className="display mt-2 text-3xl">The envelope</h2>
          <p className="measure mt-4 text-ink-soft">
            Every answer is one of two shapes. The client unwraps <code className="code">data</code>{" "}
            for you and throws <code className="code">IntelligenceClientError</code>{" "}
            carrying the status and the code otherwise — with status{" "}
            <code className="code">0</code> and code{" "}
            <code className="code">unreachable</code> when the request never landed.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <pre className="overflow-x-auto border border-rule border-l-2 border-l-derived bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed">{`{ "data": { … } }`}</pre>
            <pre className="overflow-x-auto border border-rule border-l-2 border-l-stamp bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed">{`{ "error": { "message": "…", "code": "…" } }`}</pre>
          </div>
        </section>

        <section id="the-routes" className="rule-t mt-14 pt-10">
          <p className="clause">03</p>
          <h2 className="display mt-2 text-3xl">The routes</h2>
          <p className="measure mt-4 text-ink-soft">
            All of them under <code className="code">/v1</code>. A test checks this list
            against the client’s own methods at build time, so a method cannot ship undocumented.
          </p>

          <div className="mt-10 space-y-12">
            {ROUTE_GROUPS.map((group) => (
              <div key={group.title}>
                <h3 className="display text-xl">{group.title}</h3>
                <p className="measure mt-2 text-sm text-ink-soft">{group.blurb}</p>
                <div className="mt-4">
                  {group.routes.map((route) => (
                    <div
                      key={`${route.method} ${route.path}`}
                      className="rule-t grid gap-x-5 gap-y-1.5 py-4 lg:grid-cols-[4.5rem_minmax(0,16rem)_minmax(0,1fr)]"
                    >
                      <span className="text-[0.75rem] font-bold tracking-[0.1em] text-stamp">
                        {route.method}
                      </span>
                      <span className="min-w-0 overflow-x-auto code text-[0.8125rem]">
                        {route.path}
                      </span>
                      <span className="text-[0.9375rem] leading-snug text-ink-soft">
                        {route.summary}
                        <span className="mt-1 block code text-[0.6875rem] text-ink-faint">
                          {route.client ? `${route.client}()` : "no client method"}
                          {route.budget ? ` · ${route.budget}` : ""}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="timeouts" className="rule-t mt-14 pt-10">
          <p className="clause">04</p>
          <h2 className="display mt-2 text-3xl">Timeouts</h2>
          <p className="measure mt-4 text-ink-soft">
            Each call falls under a budget, and the client aborts rather than hanging. Override any of them by passing{" "}
            <code className="code">timeouts</code>. These are the shipped defaults, read
            out of the package.
          </p>
          <div className="mt-6">
            {Object.entries(DEFAULT_TIMEOUTS).map(([name, ms]) => (
              <div key={name} className="rule-t flex items-baseline justify-between py-3">
                <span className="code text-sm">{name}</span>
                <span className="text-sm text-ink-faint">
                  {ms.toLocaleString("en-US")} ms
                </span>
              </div>
            ))}
          </div>
        </section>
      </DocBody>
    </>
  );
}
