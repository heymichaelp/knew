import type { Metadata } from "next";

import { DocBody, DocHeader } from "@/components/site/page-shell";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "No shadow profiles, isolated scopes, episodes as the source, export and delete, and a stateless mode.",
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
      "An entity exists because a knower named it. No directory, no web enrichment, no joining rosters, no identity resolution across clients.",
      "A fact that cannot attach to an entity on the roster is dropped, or becomes a proposal the client must accept.",
    ],
  },
  {
    id: "scopes-never-cross",
    clause: "02",
    title: "Scopes never cross",
    body: [
      "Every row carries a client id and a subject id, and every query filters on both. The contract suite checks it.",
      "A subject id means nothing outside the client that sent it.",
    ],
  },
  {
    id: "episodes-are-the-truth",
    clause: "03",
    title: "Episodes are the truth",
    body: [
      "What the knower said is stored verbatim and dated. Every fact names the episodes it came from, and all facts can be rebuilt from them.",
      "Facts are never edited. A correction supersedes, dated, so what was known at any date stays readable.",
    ],
  },
  {
    id: "export-and-delete",
    clause: "04",
    title: "Export and delete",
    body: [
      "One call exports everything held for a knower. One call erases it. Deleting an entity deletes the episodes about it.",
    ],
  },
  {
    id: "stateless-mode",
    clause: "05",
    title: "Stateless mode",
    body: [
      "Send the roster, the facts you hold and one episode; get a plan to apply to your own store. Nothing is stored.",
    ],
  },
] as const;

export default function PrivacyPage() {
  return (
    <>
      <DocHeader
        clause="Privacy"
        title="What it will not do."
        standfirst="Properties of the code, enforced by the contract suite."
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
            This page describes the engine. A client built on it has its own policy.
          </p>
        </div>
      </DocBody>
    </>
  );
}
