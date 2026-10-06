import type { Metadata } from "next";

import { DocBody, DocHeader } from "@/components/site/page-shell";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "No shadow profiles, scopes that never cross, episodes as the truth, export and delete — and nothing stored at all in stateless mode.",
};

const HEADINGS = [
  { id: "no-shadow-profiles", text: "No shadow profiles", level: 2 },
  { id: "scopes-never-cross", text: "Scopes never cross", level: 2 },
  { id: "episodes-are-the-truth", text: "Episodes are the truth", level: 2 },
  { id: "export-and-delete", text: "Export and delete", level: 2 },
  { id: "stateless-mode", text: "Stateless mode", level: 2 },
];

const CLAUSES = [
  {
    id: "no-shadow-profiles",
    clause: "01",
    title: "No shadow profiles",
    body: [
      "An entity exists in the engine because a knower named it. There is no directory, no enrichment from the open web, no joining of one knower's roster to another's, and no identity resolution across clients. An id is a label the client chose.",
      "A fact the engine cannot attach to an entity on the roster is not quietly kept against a stranger. It is dropped, or it becomes a proposal the client has to accept.",
    ],
  },
  {
    id: "scopes-never-cross",
    clause: "02",
    title: "Scopes never cross",
    body: [
      "Every row a knower touches carries both a client id and a subject id, and every query puts both in its WHERE. That is not a convention — it is one of the cases in the contract suite, so a driver that leaks between scopes fails to be a driver.",
      "A subject id means nothing outside the client that sent it. Two clients using the same string are talking about two unrelated ledgers.",
    ],
  },
  {
    id: "episodes-are-the-truth",
    clause: "03",
    title: "Episodes are the truth",
    body: [
      "What the knower said is stored verbatim and dated, and the question they were answering, when it was a reply, is kept beside the words rather than in them. Facts are derived from episodes, and every fact names the episodes that said it. Drop every fact and the engine rebuilds them from the words — that replay is a contract case too.",
      "Facts are never edited. A correction supersedes, dated by when it was said, so the question “what did we know in March?” has an answer in March's terms. Nothing is rewritten behind your back.",
    ],
  },
  {
    id: "export-and-delete",
    clause: "04",
    title: "Export and delete",
    body: [
      "One call exports everything held for a knower as the words, dated. One call erases them. Deleting an entity takes the words about it with it; deleting a knower leaves every other knower untouched, which the suite checks.",
      "These are routes, not a support ticket. A client can wire a data-protection request straight through.",
    ],
  },
  {
    id: "stateless-mode",
    clause: "05",
    title: "Stateless mode",
    body: [
      "A client that will not hand over its data does not have to. One call carries the roster, the facts in hand and a single episode; back comes a plan to apply to its own store. No knower is named and nothing is written down.",
      "This is the difference from every memory product: the ledger can belong entirely to the client, and the engine is then only a function.",
    ],
  },
] as const;

export default function PrivacyPage() {
  return (
    <>
      <DocHeader
        clause="Privacy"
        title="What it will not do."
        standfirst="Most of what follows is not a policy — it is a shape the code is in, held there by the contract suite. A promise a test enforces is worth more than one a page makes."
        aside={<p className="stamp">Structural, not promised</p>}
      />

      <DocBody headings={HEADINGS}>
        <div>
          {CLAUSES.map((item) => (
            <section key={item.id} id={item.id} className="rule-t py-10 first:border-t-0 first:pt-0">
              <p className="clause">{item.clause}</p>
              <h2 className="display mt-2 text-3xl">{item.title}</h2>
              <div className="measure mt-5 space-y-4 text-ink-soft">
                {item.body.map((paragraph) => (
                  <p key={paragraph.slice(0, 24)}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
          <p className="rule-t pt-6 text-sm text-ink-faint">
            This page describes the engine. A client built on it has its own policy, and the knower’s
            relationship is with that client.
          </p>
        </div>
      </DocBody>
    </>
  );
}
