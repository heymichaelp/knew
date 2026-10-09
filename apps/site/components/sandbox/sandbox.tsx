"use client";

import {
  compileLens,
  compileVocabulary,
  endedByDate,
  factsKnownAt,
  isDueForRevisit,
  KNOWER_ID,
  lensProblems,
  mustHonorFrom,
  parseLensDefinition,
  parseVocabularyDefinition,
  readinessFor,
  renderBrief,
  subjectOf,
  type Fact,
  type Lens,
  type LensDefinition,
  type NeedSpec,
  type NeedState,
  type Subject,
  type Vocabulary,
} from "@popjoker/knew";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { EXAMPLES, type DraftFact, type SandboxExample } from "@/lib/sandbox-examples";
import { SUBJECTS } from "@/lib/subjects";

/*
  Everything this page reports is the engine's: the vocabulary and the lens are
  compiled by the package, and the page, the needs and the directions come
  from renderBrief and readinessFor, run in the browser on every change.
*/

/* ------------------------------------------------------------------ state */

interface SandboxState {
  /** The example it started from. */
  base: string;
  name: string;
  fields: Record<string, string>;
  at: string;
  vocabText: string;
  lensText: string;
  facts: DraftFact[];
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

const exampleById = (id: string) => EXAMPLES.find((example) => example.id === id) ?? EXAMPLES[0]!;

function stateOf(example: SandboxExample): SandboxState {
  return {
    base: example.id,
    name: example.name,
    fields: {},
    at: example.at,
    vocabText: json(example.vocabulary),
    lensText: json(example.lens),
    facts: example.facts.map((fact) => ({ ...fact, attributes: { ...fact.attributes } })),
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);
const isDay = (value: unknown): value is string => typeof value === "string" && DAY_RE.test(value) && !Number.isNaN(dateOf(value).getTime());

function shiftDay(day: string, months: number): string {
  const date = dateOf(day);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------- the link  */

/** What a shared link carries: the example, and only what differs from it. */
function encodeState(state: SandboxState): string {
  const base = stateOf(exampleById(state.base));
  const shared = {
    base: state.base,
    name: state.name,
    fields: state.fields,
    at: state.at,
    facts: state.facts,
    ...(state.vocabText === base.vocabText ? {} : { vocab: state.vocabText }),
    ...(state.lensText === base.lensText ? {} : { lens: state.lensText }),
  };
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(shared))) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const asText = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);

function decodeState(hash: string): SandboxState | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const start = params.get("start");
  if (start && EXAMPLES.some((example) => example.id === start)) return stateOf(exampleById(start));
  const encoded = params.get("s");
  if (!encoded) return null;
  try {
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    const shared = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as Record<string, unknown>;
    const base = stateOf(exampleById(asText(shared.base, EXAMPLES[0]!.id)));
    const facts = Array.isArray(shared.facts) ? (shared.facts as Array<Record<string, unknown>>) : [];
    const fields = typeof shared.fields === "object" && shared.fields !== null ? (shared.fields as Record<string, unknown>) : {};
    return {
      base: base.base,
      name: asText(shared.name, base.name),
      fields: Object.fromEntries(Object.entries(fields).filter(([, value]) => typeof value === "string")) as Record<string, string>,
      at: isDay(shared.at) ? shared.at : base.at,
      vocabText: asText(shared.vocab, base.vocabText),
      lensText: asText(shared.lens, base.lensText),
      facts: facts
        .filter((fact) => typeof fact.type === "string" && typeof fact.text === "string")
        .map((fact, index) => ({
          id: asText(fact.id, `shared-${index + 1}`),
          type: fact.type as string,
          text: fact.text as string,
          said: isDay(fact.said) ? fact.said : base.at,
          from: isDay(fact.from) ? fact.from : "",
          until: isDay(fact.until) ? fact.until : "",
          attributes:
            typeof fact.attributes === "object" && fact.attributes !== null
              ? (Object.fromEntries(Object.entries(fact.attributes).filter(([, value]) => typeof value === "string")) as Record<string, string>)
              : {},
        })),
    };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- the engine  */

type Attempt<T> = { ok: true; value: T } | { ok: false; problems: string[] };

/** A thrown error as lines a reader can act on: zod's issues by path, or the message. */
function problemsOf(error: unknown): string[] {
  const issues = (error as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues;
  if (Array.isArray(issues)) return issues.map((issue) => `${issue.path.map(String).join(".") || "(top level)"}: ${issue.message}`);
  return [error instanceof Error ? error.message : String(error)];
}

function attempt<T>(run: () => T): Attempt<T> {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, problems: problemsOf(error) };
  }
}

function compileBoth(vocabText: string, lensText: string): { vocabulary: Attempt<Vocabulary>; lens: Attempt<Lens> } {
  const vocabulary = attempt(() => compileVocabulary(parseVocabularyDefinition(JSON.parse(vocabText))));
  if (!vocabulary.ok) return { vocabulary, lens: { ok: false, problems: ["the lens is compiled against the vocabulary, which does not compile"] } };
  const definition = attempt(() => parseLensDefinition(JSON.parse(lensText)));
  if (!definition.ok) return { vocabulary, lens: definition };
  const problems = lensProblems(definition.value, vocabulary.value);
  if (problems.length > 0) return { vocabulary, lens: { ok: false, problems } };
  return { vocabulary, lens: attempt(() => compileLens(definition.value, vocabulary.value)) };
}

/** A draft as the engine holds it: a fact about the knower is filed on `self`, the rest on the entity. */
function factOf(vocabulary: Vocabulary, draft: DraftFact): Fact {
  return {
    id: draft.id,
    entityId: subjectOf(vocabulary, draft.type) === "knower" ? KNOWER_ID : "entity",
    objectId: null,
    type: draft.type,
    fact: draft.text,
    attributes: { ...draft.attributes },
    validAt: draft.from ? dateOf(draft.from) : null,
    invalidAt: draft.until ? dateOf(draft.until) : null,
    createdAt: dateOf(draft.said),
    lastSaidAt: null,
    expiredAt: null,
    supersededById: null,
    episodeIds: [draft.id],
  };
}

/** A lens's needs written out, so one can be changed: its own, or one per dimension when it names none. */
function needsOf(lens: Lens): NeedSpec[] {
  return (
    lens.definition.needs?.map((need) => ({ ...need })) ??
    lens.needs.map((need) => ({ id: need.id, ...(need.dimension ? { dimension: need.dimension } : { label: need.label, types: [...need.types] }) }))
  );
}

/* ------------------------------------------------------------ the words  */

const SUBJECT_HEADING: Record<Subject, string> = Object.fromEntries(SUBJECTS.map(({ about, heading }) => [about, heading])) as Record<Subject, string>;

const STATE_WORDS: Record<NeedState, string> = {
  met: "Met",
  thin: "Thin",
  open: "Open",
  due: "Due for a revisit",
  waiting: "Waiting",
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

/* ---------------------------------------------------------------- pieces */

const INPUT =
  "w-full rounded-md border border-rule bg-paper-raised px-3 py-2 text-[0.9375rem] text-ink placeholder:text-ink-faint focus:border-stamp focus:outline-none";
const BUTTON = "text-sm text-ink-soft underline decoration-rule-strong underline-offset-4 transition-colors hover:text-stamp hover:decoration-stamp disabled:opacity-40";

function Panel({ clause, title, children, aside }: { clause: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rule-t pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className="clause">{clause}</p>
          <h2 className="display mt-1 text-2xl">{title}</h2>
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint ? <span className="mt-1 block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

function Problems({ problems }: { problems: string[] }) {
  return (
    <ul className="mt-3 space-y-1 border-l-2 border-stamp bg-stamp-wash px-4 py-3 text-sm text-ink">
      {problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  );
}

function Bar({ value, tone }: { value: number; tone: "stamp" | "derived" }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-paper-sunken">
      <span className={`block h-full rounded-full ${tone === "stamp" ? "bg-stamp" : "bg-derived"}`} style={{ width: percent(value) }} />
    </span>
  );
}

/* ------------------------------------------------------------ the editor  */

interface FactForm {
  editing: string | null;
  type: string;
  text: string;
  said: string;
  from: string;
  until: string;
  attributes: Record<string, string>;
}

const emptyForm = (type: string, said: string): FactForm => ({ editing: null, type, text: "", said, from: "", until: "", attributes: {} });

export function Sandbox() {
  const [state, setState] = useState<SandboxState>(() => stateOf(EXAMPLES[0]!));
  const [form, setForm] = useState<FactForm>(() => emptyForm("", EXAMPLES[0]!.at));
  const [copied, setCopied] = useState(false);

  // A link opens what it carries. Read after hydration, so the server's page and the first render agree.
  useEffect(() => {
    const open = () => {
      const shared = decodeState(window.location.hash);
      if (shared) {
        setState(shared);
        setForm(emptyForm("", shared.at));
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  const { vocabulary, lens } = useMemo(() => compileBoth(state.vocabText, state.lensText), [state.vocabText, state.lensText]);
  const at = dateOf(state.at);

  const report = useMemo(() => {
    if (!vocabulary.ok || !lens.ok) return null;
    const at = dateOf(state.at);
    const ledger = state.facts.map((draft) => factOf(vocabulary.value, draft));
    const known = factsKnownAt(ledger, at);
    const entity = { name: state.name || "them", fields: Object.fromEntries(vocabulary.value.fields.map((field) => [field, state.fields[field] || null])) };
    const ofEntity = known.filter((fact) => fact.entityId !== KNOWER_ID);
    const ofKnower = known.filter((fact) => fact.entityId === KNOWER_ID);
    return {
      ledger: new Map(ledger.map((fact) => [fact.id, fact])),
      known: new Set(known.map((fact) => fact.id)),
      page: renderBrief(lens.value, { entity, summary: "", facts: ofEntity, knower: ofKnower, at }),
      readiness: readinessFor(lens.value, entity, ofEntity, at, ofKnower),
      mustHonor: mustHonorFrom(lens.value, ofEntity, at, ofKnower),
    };
  }, [vocabulary, lens, state.facts, state.name, state.fields, state.at]);

  const change = (patch: Partial<SandboxState>) => setState((current) => ({ ...current, ...patch }));

  const load = (example: SandboxExample) => {
    setState(stateOf(example));
    setForm(emptyForm("", example.at));
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  };

  const editLens = (edit: (definition: LensDefinition, needs: NeedSpec[]) => LensDefinition) => {
    if (!lens.ok) return;
    change({ lensText: json(edit({ ...lens.value.definition }, needsOf(lens.value))) });
  };

  const typeKeys = vocabulary.ok ? vocabulary.value.factTypeKeys : [];
  const formType = typeKeys.includes(form.type) ? form.type : (typeKeys[0] ?? "");
  const formAttributes = vocabulary.ok ? (vocabulary.value.definition.factTypes[formType]?.attributes ?? []) : [];

  const saveFact = () => {
    if (!form.text.trim() || !formType) return;
    const draft: DraftFact = {
      id: form.editing ?? `fact-${Date.now().toString(36)}`,
      type: formType,
      text: form.text.trim(),
      said: isDay(form.said) ? form.said : state.at,
      from: isDay(form.from) ? form.from : "",
      until: isDay(form.until) ? form.until : "",
      attributes: Object.fromEntries(Object.entries(form.attributes).filter(([name, value]) => value && formAttributes.some((a) => a.name === name))),
    };
    change({ facts: form.editing ? state.facts.map((fact) => (fact.id === form.editing ? draft : fact)) : [...state.facts, draft] });
    setForm(emptyForm(formType, state.at));
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#s=${encodeState(state)}`;
    history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The address bar holds it either way.
    }
  };

  const base = exampleById(state.base);

  return (
    <div className="mx-auto max-w-6xl px-6 pb-8">
      {/* -------------------------------------------------------- examples */}
      <div>
        <p className="label">Start from</p>
        <div className="mt-3 grid gap-px bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {EXAMPLES.filter((example) => example.facts.length > 0).map((example) => (
            <button
              key={example.id}
              type="button"
              onClick={() => load(example)}
              aria-pressed={state.base === example.id}
              className={`p-5 text-left transition-colors ${state.base === example.id ? "bg-paper-sunken" : "bg-paper-raised hover:bg-paper-sunken"}`}
            >
              <span className={`display block text-lg ${state.base === example.id ? "text-stamp" : "text-ink"}`}>{example.title}</span>
              <span className="mt-1.5 block text-sm leading-relaxed text-ink-soft">{example.blurb}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-faint">
          Or start empty:{" "}
          {EXAMPLES.filter((example) => example.facts.length === 0).map((example, index, all) => (
            <span key={example.id}>
              <button type="button" className={BUTTON} onClick={() => load(example)}>
                {example.preset}
              </button>
              {index < all.length - 1 ? ", " : "."}
            </span>
          ))}
        </p>
      </div>

      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ====================================================== inputs */}
        <div className="min-w-0 space-y-10">
          <Panel
            clause="01 — What you know"
            title={`About ${state.name || "them"}`}
            aside={
              <span className="flex gap-4">
                <button type="button" className={BUTTON} onClick={() => load(base)}>
                  Reset
                </button>
                <button type="button" className={BUTTON} onClick={share}>
                  {copied ? "Link copied" : "Copy a link"}
                </button>
              </span>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <input className={INPUT} value={state.name} onChange={(event) => change({ name: event.target.value })} />
              </Field>
              <Field label="As of" hint="The moment the page and readiness describe.">
                <input
                  type="date"
                  className={INPUT}
                  value={state.at}
                  onChange={(event) => isDay(event.target.value) && change({ at: event.target.value })}
                />
              </Field>
              {vocabulary.ok
                ? vocabulary.value.fields.map((field) => (
                    <Field key={field} label={field}>
                      <input
                        className={INPUT}
                        value={state.fields[field] ?? ""}
                        onChange={(event) => change({ fields: { ...state.fields, [field]: event.target.value } })}
                      />
                    </Field>
                  ))
                : null}
            </div>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-faint">
              <span>Move time:</span>
              {[
                [-12, "a year back"],
                [-1, "a month back"],
                [1, "a month on"],
                [6, "six months on"],
                [12, "a year on"],
              ].map(([months, words]) => (
                <button key={words} type="button" className={BUTTON} onClick={() => change({ at: shiftDay(state.at, months as number) })}>
                  {words}
                </button>
              ))}
            </p>

            {/* the ledger */}
            {vocabulary.ok && report ? (
              <div className="mt-6">
                {SUBJECTS.map(({ about, heading }) => {
                  const facts = state.facts.filter((draft) => subjectOf(vocabulary.value, draft.type) === about);
                  const has = vocabulary.value.dimensions.some((dimension) => dimension.about === about);
                  if (!has && facts.length === 0) return null;
                  return (
                    <div key={about} className="mt-5">
                      <p className="label">{heading}</p>
                      {facts.length === 0 ? <p className="mt-2 text-sm text-ink-faint">Nothing yet.</p> : null}
                      {facts.map((draft) => {
                        const fact = report.ledger.get(draft.id)!;
                        const marks = [
                          report.known.has(draft.id) ? null : "not said yet",
                          report.known.has(draft.id) && endedByDate(fact, at) ? "over" : null,
                          report.known.has(draft.id) && !endedByDate(fact, at) && isDueForRevisit(vocabulary.value, fact, at) ? "due for a revisit" : null,
                        ].filter((mark) => mark !== null);
                        const values = Object.values(draft.attributes).filter(Boolean);
                        return (
                          <div key={draft.id} className={`ledger-row ${report.known.has(draft.id) ? "" : "opacity-50"}`}>
                            <span className="code text-[0.6875rem] tracking-[0.12em] break-all text-stamp">{draft.type}</span>
                            <span className="text-[0.9375rem] leading-snug">
                              {draft.text}
                              <span className="mt-0.5 block text-xs text-ink-faint">
                                {values.length > 0 ? `${values.join(", ")} · ` : ""}
                                said {draft.said}
                                {draft.from ? ` · from ${draft.from}` : ""}
                                {draft.until ? ` · until ${draft.until}` : ""}
                                {marks.length > 0 ? <span className="text-stamp"> · {marks.join(", ")}</span> : null}
                              </span>
                            </span>
                            <span className="flex gap-3 text-xs">
                              <button
                                type="button"
                                className={BUTTON}
                                onClick={() => setForm({ editing: draft.id, ...draft, attributes: { ...draft.attributes } })}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={BUTTON}
                                onClick={() => {
                                  change({ facts: state.facts.filter((fact) => fact.id !== draft.id) });
                                  if (form.editing === draft.id) setForm(emptyForm(formType, state.at));
                                }}
                              >
                                Remove
                              </button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <p className="mt-6 lg:hidden">
              <a href="#report" className={BUTTON}>
                See what the engine reports ↓
              </a>
            </p>
          </Panel>

          {/* add a fact */}
          {vocabulary.ok ? (
            <Panel clause="02 — A fact" title={form.editing ? "Change a fact" : "Add a fact"}>
              <p className="text-sm text-ink-soft">
                In an app, a model reads notes into facts like these. Here you write them yourself. Its type decides its subject: a fact about you
                is kept on <code className="code">self</code>, beside every entity.
              </p>
              <form
                className="mt-4 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveFact();
                }}
              >
                <Field
                  label="Type"
                  hint={
                    formType ? (
                      <>
                        {SUBJECT_HEADING[subjectOf(vocabulary.value, formType)]}: {vocabulary.value.factTypes[formType]!.description}
                      </>
                    ) : null
                  }
                >
                  <select className={INPUT} value={formType} onChange={(event) => setForm({ ...form, type: event.target.value, attributes: {} })}>
                    {vocabulary.value.dimensions.map((dimension) => (
                      <optgroup key={dimension.id} label={`${dimension.label} · ${SUBJECT_HEADING[dimension.about].toLowerCase()}`}>
                        {typeKeys
                          .filter((key) => vocabulary.value.factTypes[key]!.dimension === dimension.id)
                          .map((key) => (
                            <option key={key} value={key}>
                              {key}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Field label="What was said">
                  <input
                    className={INPUT}
                    value={form.text}
                    placeholder="Loves matcha."
                    onChange={(event) => setForm({ ...form, text: event.target.value })}
                  />
                </Field>
                {formAttributes.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {formAttributes.map((attribute) => (
                      <Field key={attribute.name} label={attribute.name}>
                        {attribute.kind === "enum" ? (
                          <select
                            className={INPUT}
                            value={form.attributes[attribute.name] ?? ""}
                            onChange={(event) => setForm({ ...form, attributes: { ...form.attributes, [attribute.name]: event.target.value } })}
                          >
                            <option value="">Not said</option>
                            {(attribute.values ?? []).map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className={INPUT}
                            value={form.attributes[attribute.name] ?? ""}
                            onChange={(event) => setForm({ ...form, attributes: { ...form.attributes, [attribute.name]: event.target.value } })}
                          />
                        )}
                      </Field>
                    ))}
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Said on">
                    <input type="date" className={INPUT} value={form.said} onChange={(event) => setForm({ ...form, said: event.target.value })} />
                  </Field>
                  <Field label="True from">
                    <input type="date" className={INPUT} value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} />
                  </Field>
                  <Field label="Until">
                    <input type="date" className={INPUT} value={form.until} onChange={(event) => setForm({ ...form, until: event.target.value })} />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <button
                    type="submit"
                    disabled={!form.text.trim()}
                    className="border border-ink bg-ink px-5 py-2 text-sm text-paper transition-colors hover:border-stamp hover:bg-stamp disabled:opacity-40"
                  >
                    {form.editing ? "Save the fact" : "Add the fact"}
                  </button>
                  {form.editing ? (
                    <button type="button" className={BUTTON} onClick={() => setForm(emptyForm(formType, state.at))}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            </Panel>
          ) : null}

          {/* the lens's needs */}
          <Panel clause="03 — The goal" title="What it needs understood">
            {lens.ok ? (
              <>
                <p className="text-sm text-ink-soft">
                  {lens.value.objective ? <>“{lens.value.objective}” </> : null}
                  Each need counts the facts of a dimension, or of named types. Weight orders what to learn; it never changes the page.
                </p>
                <div className="mt-4">
                  {lens.value.needs.map((need, index) => (
                    <div key={need.id} className="rule-t grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_auto] items-center gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-[0.9375rem] leading-snug">{need.label}</span>
                        <span className="block text-xs text-ink-faint">
                          {SUBJECT_HEADING[need.about]}
                          {need.after.length > 0 ? ` · after ${need.after.map((id) => lens.value.needs.find((n) => n.id === id)?.label ?? id).join(", ")}` : ""}
                        </span>
                      </span>
                      <label className="text-xs text-ink-faint">
                        {index === 0 ? <span className="mb-1 block">Weight</span> : null}
                        <input
                          type="number"
                          min={0.5}
                          max={1000}
                          step={0.5}
                          className={`${INPUT} px-2 py-1 text-sm`}
                          value={need.weight}
                          aria-label={`Weight of ${need.label}`}
                          onChange={(event) => {
                            const weight = Number(event.target.value);
                            if (weight > 0 && weight <= 1000)
                              editLens((definition, needs) => ({ ...definition, needs: needs.map((n) => (n.id === need.id ? { ...n, weight } : n)) }));
                          }}
                        />
                      </label>
                      <label className="text-xs text-ink-faint">
                        {index === 0 ? <span className="mb-1 block">Enough</span> : null}
                        <input
                          type="number"
                          min={1}
                          max={20}
                          step={1}
                          className={`${INPUT} px-2 py-1 text-sm`}
                          value={need.enough}
                          aria-label={`Facts that meet ${need.label}`}
                          onChange={(event) => {
                            const enough = Math.round(Number(event.target.value));
                            if (enough >= 1)
                              editLens((definition, needs) => ({ ...definition, needs: needs.map((n) => (n.id === need.id ? { ...n, enough } : n)) }));
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className={`${BUTTON} ${index === 0 ? "mt-5" : ""} text-xs`}
                        aria-label={`Remove ${need.label}`}
                        onClick={() =>
                          editLens((definition, needs) => ({
                            ...definition,
                            needs: needs
                              .filter((n) => n.id !== need.id)
                              .map(({ after, ...n }) => {
                                const kept = (after ?? []).filter((id) => id !== need.id);
                                return kept.length > 0 ? { ...n, after: kept } : n;
                              }),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Add a need for">
                    <select
                      className={INPUT}
                      value=""
                      onChange={(event) => {
                        const dimension = event.target.value;
                        if (!dimension) return;
                        editLens((definition, needs) => {
                          let id = dimension;
                          for (let n = 2; needs.some((need) => need.id === id); n++) id = `${dimension}-${n}`;
                          return { ...definition, needs: [...needs, { id, dimension }] };
                        });
                      }}
                    >
                      <option value="">A dimension…</option>
                      {vocabulary.ok
                        ? vocabulary.value.dimensions.map((dimension) => (
                            <option key={dimension.id} value={dimension.id}>
                              {dimension.label} ({SUBJECT_HEADING[dimension.about].toLowerCase()})
                            </option>
                          ))
                        : null}
                    </select>
                  </Field>
                  <Field label="Directions run">
                    <select
                      className={INPUT}
                      value={lens.value.order}
                      onChange={(event) => {
                        const order = event.target.value as "value" | "listed";
                        editLens((definition) => {
                          const next = { ...definition };
                          if (order === "listed") next.order = "listed";
                          else delete next.order;
                          return next;
                        });
                      }}
                    >
                      <option value="value">By value: weight × what is missing</option>
                      <option value="listed">In the order the needs are listed</option>
                    </select>
                  </Field>
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-soft">The lens does not compile; fix it below.</p>
            )}
          </Panel>

          {/* the definitions */}
          <Panel clause="04 — The shapes" title="The vocabulary and the lens">
            <p className="text-sm text-ink-soft">
              The definitions as a client registers them. Change a dimension&apos;s <code className="code">about</code>, a type&apos;s{" "}
              <code className="code">revisitAfterDays</code>, or a section, and everything above and beside follows.
            </p>
            <details className="mt-4" open={!vocabulary.ok}>
              <summary className="cursor-pointer text-sm text-ink hover:text-stamp">The vocabulary</summary>
              <textarea
                className={`${INPUT} code mt-3 h-96 text-[0.75rem] leading-relaxed`}
                spellCheck={false}
                value={state.vocabText}
                onChange={(event) => change({ vocabText: event.target.value })}
              />
              {!vocabulary.ok ? <Problems problems={vocabulary.problems} /> : null}
            </details>
            <details className="mt-4" open={vocabulary.ok && !lens.ok}>
              <summary className="cursor-pointer text-sm text-ink hover:text-stamp">The lens</summary>
              <textarea
                className={`${INPUT} code mt-3 h-96 text-[0.75rem] leading-relaxed`}
                spellCheck={false}
                value={state.lensText}
                onChange={(event) => change({ lensText: event.target.value })}
              />
              {vocabulary.ok && !lens.ok ? <Problems problems={lens.problems} /> : null}
            </details>
          </Panel>
        </div>

        {/* ===================================================== results */}
        <div id="report" className="min-w-0 space-y-10">
          {report && lens.ok ? (
            <Results report={report} lens={lens.value} />
          ) : (
            <Panel clause="What the engine reports" title="Nothing to report yet">
              <p className="text-sm text-ink-soft">The vocabulary or the lens does not compile:</p>
              <Problems problems={[...(vocabulary.ok ? [] : vocabulary.problems), ...(lens.ok ? [] : lens.problems)]} />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the report */

interface Report {
  ledger: Map<string, Fact>;
  known: Set<string>;
  page: string | null;
  readiness: ReturnType<typeof readinessFor>;
  mustHonor: ReturnType<typeof mustHonorFrom>;
}

function Results({ report, lens }: { report: Report; lens: Lens }) {
  const { readiness } = report;
  const missing = readiness.needs.filter((need) => need.state !== "met");
  const textOf = (id: string) => report.ledger.get(id)?.fact ?? id;
  return (
    <>
      <Panel
        clause="What the engine reports"
        title="The next direction"
        aside={
          readiness.overall === null ? null : (
            <span className="text-sm text-ink-soft">
              Understood for this goal: <span className="text-ink">{percent(readiness.overall)}</span>
            </span>
          )
        }
      >
        {readiness.next.length === 0 ? (
          <p className="text-[0.9375rem] text-ink-soft">Every need is met. There is nowhere it needs to go next.</p>
        ) : (
          <ol className="space-y-4">
            {readiness.next.map((direction, index) => (
              <li key={direction.need} className={`border-l-2 pl-4 ${index === 0 ? "border-derived" : "border-rule-strong"}`}>
                <p className="label" style={index === 0 ? { color: "var(--derived)" } : undefined}>
                  {index === 0 ? "Next" : `Then, ${index + 1}`} · {direction.kind} · {SUBJECT_HEADING[direction.about].toLowerCase()} · value{" "}
                  {direction.value}
                </p>
                <p className={`mt-1 leading-snug ${index === 0 ? "text-lg" : "text-[0.9375rem]"}`}>{direction.label}</p>
                {direction.factIds.length > 0 ? (
                  <p className="mt-1 text-sm text-ink-faint">
                    {direction.kind === "revisit" ? "Confirm: " : "Builds on: "}
                    {direction.factIds.map(textOf).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel clause="Missing understanding" title="The needs">
        <p className="text-sm text-ink-soft">
          {missing.length === 0 ? "All met." : `${missing.length} of ${readiness.needs.length} not met.`} A need is met by enough facts, each said within
          its type&apos;s revisit window.
        </p>
        <div className="mt-3">
          {readiness.needs.map((need) => (
            <div key={need.id} className="rule-t grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-4 gap-y-1 py-2.5">
              <span className="min-w-0">
                <span className="block text-[0.9375rem] leading-snug">{need.label}</span>
                <span className="block text-xs text-ink-faint">
                  {SUBJECT_HEADING[need.about]} · {STATE_WORDS[need.state]}
                  {need.waitingOn.length > 0
                    ? ` on ${need.waitingOn.map((id) => readiness.needs.find((n) => n.id === id)?.label ?? id).join(", ")}`
                    : ""}{" "}
                  · {need.facts} of {need.enough}
                  {need.due > 0 ? `, ${need.due} due` : ""} · weighs {need.weight}
                </span>
              </span>
              <Bar value={need.strength} tone={need.state === "met" ? "derived" : "stamp"} />
            </div>
          ))}
        </div>
        {lens.needs.length > readiness.needs.length ? (
          <p className="mt-2 text-xs text-ink-faint">Needs whose conditions this entity&apos;s fields do not match are left out.</p>
        ) : null}
      </Panel>

      <Panel clause="Current understanding" title="By dimension">
        {SUBJECTS.filter(({ about }) => readiness.dimensions.some((dimension) => dimension.about === about)).map(({ about, heading }) => (
          <div key={about} className="mt-4 first:mt-0">
            <p className="label">{heading}</p>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
              {readiness.dimensions
                .filter((dimension) => dimension.about === about)
                .map((dimension) => (
                  <div key={dimension.id} className="contents">
                    <span className={dimension.facts > 0 ? "text-ink" : "text-ink-faint"}>{dimension.label}</span>
                    <span className="text-right text-ink-faint">
                      {dimension.facts === 0 ? "nothing yet" : `${dimension.facts} fact${dimension.facts === 1 ? "" : "s"}`}
                      {dimension.due > 0 ? <span className="text-stamp">, {dimension.due} due</span> : null}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ))}
        {report.mustHonor.length > 0 ? (
          <div className="mt-6">
            <p className="label">To honor, whatever the goal</p>
            <ul className="mt-2 space-y-1 text-[0.9375rem]">
              {report.mustHonor.map((line) => (
                <li key={`${line.type}:${line.fact}`}>
                  <span className="code text-[0.6875rem] tracking-[0.12em] text-stamp">{line.type}</span> {line.fact}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel clause="Current understanding" title="The page">
        {report.page ? (
          <pre className="border-l-2 border-rule-strong bg-paper-sunken p-4 code text-[0.75rem] leading-relaxed whitespace-pre-wrap">{report.page}</pre>
        ) : (
          <p className="text-[0.9375rem] text-ink-soft">No page: nothing is known about them yet. What is known about you alone makes none.</p>
        )}
      </Panel>
    </>
  );
}
