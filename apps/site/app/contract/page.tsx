import type { Metadata } from "next";

import { DocBody, DocHeader } from "@/components/site/page-shell";
import { contractCaseSummaries } from "@/lib/engine";

export const metadata: Metadata = {
  title: "The contract",
  description: "One interface, and the cases every driver must pass. The list is the code.",
};

const HEADINGS = [
  { id: "one-door", text: "One door", level: 2 },
  { id: "the-cases", text: "The cases", level: 2 },
  { id: "proving-a-driver", text: "Proving a driver", level: 2 },
];

export default function ContractPage() {
  const cases = contractCaseSummaries();
  const scripted = cases.filter((c) => c.scripted);

  return (
    <>
      <DocHeader
        clause="The contract"
        title={`“Implements the contract” means one thing.`}
        standfirst="There are three drivers of PeopleIntelligence — Postgres, HTTP, and an in-memory fake — and one suite that runs the same cases against all of them. A driver either passes it or does not claim the name."
        aside={
          <p className="stamp">
            <span>{cases.length} cases</span>
            <span aria-hidden>·</span>
            <span>{scripted.length} scripted</span>
          </p>
        }
      />

      <DocBody headings={HEADINGS}>
        <section id="one-door">
          <p className="clause">01</p>
          <h2 className="display mt-2 text-3xl">One door</h2>
          <p className="measure mt-4 text-ink-soft">
            Everything reaches the store through <code className="code">PeopleIntelligence</code>.
            It carries a scope — <code className="code">{`{ clientId, subjectId }`}</code>{" "}
            — on every call and never a database handle. A route is a thin skin over a contract method; a business rule
            lives behind the door, never in front of it.
          </p>
          <pre className="mt-6 overflow-x-auto border border-rule border-l-2 border-l-stamp bg-paper-sunken p-5 code text-[0.8125rem] leading-relaxed">
            {`import { contractSuite } from "@popjoker/knew/testing";
import { test } from "node:test";

contractSuite({
  test,
  open: async () => ({ /* your driver, a scope, and a close() */ }),
  scripted: true, // false if your driver cannot stub the model
});`}
          </pre>
        </section>

        <section id="the-cases" className="rule-t mt-14 pt-10">
          <p className="clause">02</p>
          <h2 className="display mt-2 text-3xl">The cases</h2>
          <p className="measure mt-4 text-ink-soft">
            Listed below by <code className="code">contractCases()</code> itself, not
            transcribed. Each name is the sentence the suite registers it under. A{" "}
            <span style={{ color: "var(--derived)" }}>scripted</span> case needs a driver that can stand in for the
            model; the rest hold for any driver, and are withheld rather than failed when it cannot.
          </p>

          <ol className="mt-10">
            {cases.map((item, index) => (
              <li key={item.name} className="rule-t grid gap-x-6 gap-y-2 py-5 lg:grid-cols-[3rem_minmax(0,1fr)_6rem]">
                <span className="text-[0.8125rem] italic text-ink-faint">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="text-[1.0125rem] leading-relaxed">{item.name}</p>
                <span
                  className="text-[0.6875rem] tracking-[0.1em] uppercase lg:text-right"
                  style={{ color: item.scripted ? "var(--derived)" : "var(--ink-faint)" }}
                >
                  {item.scripted ? "scripted" : "any driver"}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section id="proving-a-driver" className="rule-t mt-14 pt-10">
          <p className="clause">03</p>
          <h2 className="display mt-2 text-3xl">Proving a driver</h2>
          <p className="measure mt-4 text-ink-soft">
            A change to what a driver must do is a change to the suite first, a major of the package, and a line in the
            changelog. That order is the whole point: the cases are the specification, and the specification ships in
            the tarball so every driver is held to the same one.
          </p>
          <p className="measure mt-4 text-ink-soft">
            The fake in <code className="code">@popjoker/knew/testing</code> passes all{" "}
            {cases.length}, which is also how a client tests its own code without a database or a model.
          </p>
        </section>
      </DocBody>
    </>
  );
}
