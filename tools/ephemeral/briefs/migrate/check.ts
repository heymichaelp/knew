import { gapsFor, mustHonorFrom, renderBrief, type Fact, type IntelligenceScope, type Lens } from "@popjoker/knew";
import { extracted, extraction, fakeIntelligence } from "@popjoker/knew/testing";
import {
  Checks,
  ensure,
  importApp,
  loadDefinitions,
  recording,
  standardChecks,
  type CheckOptions,
  type CheckResult,
  type Definitions,
} from "../../kit/check-kit.ts";

/**
 * migrate: a team on 0.2.1 moves its lens and its app to 1.0, and nothing its
 * staff see changes.
 *
 * Everything in `CAPTURED_FROM_0_2_1` was rendered by @popjoker/knew 0.2.1
 * itself, installed from npm, from `inputs/legacy-lens.json` and the facts
 * below (in 0.2.1's own shape), on 2026-10-06. It is never regenerated from
 * the code it checks: it is what "unchanged" means. A definition that renders
 * these pages, honors these facts and asks these questions passes, however it
 * was written.
 */

const LENS = "regulars";
const NOW = new Date("2026-10-05T00:00:00Z");
const SUMMARY = "A regular since 2019 who buys for the family's big days.";

const CAPTURED_FROM_0_2_1 = {
  pages: {
    ruth:
      "Before you take an order from Ruth Alder (regular):\n\nA regular since 2019 who buys for the family's big days.\n\nNever send:\n- Lilies: the cat is poisoned by them (told us 2026-02-03)\n\nOrders:\n- Leave it with the neighbour at number 12 if nobody is in (told us 2026-05-10)\n- Usually spends about £60 (told us 2026-03-01)\n\nDates they buy for:\n- Their mother's birthday in March [mar] (told us 2026-03-01)\n- Wedding anniversary on 14 June [jun] (told us 3 times, first 2025-06-01)\n\nLikes:\n- Garden roses in apricot and cream (told us 2026-04-11)\n- Nothing dyed or glittered (told us 2026-01-20)\n\nOther:\n- Asked about the wreath workshop (told us 2025-09-09)\n\nNo longer true:\n- Deliver to the office on Mill Lane (since 2025-01; until 2026-08; told us 2025-01-05)",
    ruthTight:
      "Before you take an order from Ruth Alder (regular):\n\nA regular since 2019 who buys for the family's big days.\n\nNever send:\n- Lilies: the cat is poisoned by them (told us 2026-02-03)\n\nOrders:\n- Leave it with the neighbour at number 12 if nobody is in (told us 2026-05-10)\n\n(+7 older facts not shown)",
    bloom: "Before you take an order from Bloom & Co (Wholesale):\n\nLikes:\n- Eucalyptus by the armful (told us 2026-09-01)",
    nobody: null,
  },
  mustHonor: [
    { type: "ALLERGY", fact: "Lilies: the cat is poisoned by them" },
    { type: "DELIVERY", fact: "Leave it with the neighbour at number 12 if nobody is in" },
  ],
  gaps: {
    ruth: ["who-they-send-to"],
    bloom: ["dates", "standing-order", "who-they-send-to"],
    bloomShouting: ["favorites", "dates", "standing-order", "who-they-send-to"],
    theo: ["favorites", "dates", "who-they-send-to"],
    trade: ["favorites", "dates", "who-they-send-to"],
  },
  questions: {
    favorites: "What do they love to get?",
    dates: "Which dates do they buy for every year?",
    "standing-order": "How often do they reorder, and how much do they spend?",
    "who-they-send-to": "Who do they usually send to?",
  },
} as const;

// The capture's facts, in the capture's order (ids decide ties), in 1.0's shape.
let counter = 0;
const fact = (type: string, text: string, said: string, extra: Partial<Fact> = {}): Fact => ({
  id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  entityId: "ruth",
  objectId: null,
  type,
  fact: text,
  attributes: {},
  validAt: null,
  invalidAt: null,
  createdAt: new Date(`${said}T00:00:00Z`),
  lastSaidAt: null,
  expiredAt: null,
  supersededById: null,
  episodeIds: ["e1"],
  ...extra,
});
const RUTH_FACTS: Fact[] = [
  fact("ALLERGY", "Lilies: the cat is poisoned by them", "2026-02-03"),
  fact("DELIVERY", "Leave it with the neighbour at number 12 if nobody is in", "2026-05-10"),
  fact("OCCASION", "Wedding anniversary on 14 June", "2025-06-01", { attributes: { month: "jun" }, episodeIds: ["e1", "e2", "e3"] }),
  fact("FAVORITE", "Garden roses in apricot and cream", "2026-04-11"),
  fact("DISLIKE", "Nothing dyed or glittered", "2026-01-20"),
  fact("BUDGET", "Usually spends about £60", "2026-03-01"),
  fact("WORKSHOP", "Asked about the wreath workshop", "2025-09-09"),
  fact("DELIVERY", "Deliver to the office on Mill Lane", "2025-01-05", { validAt: new Date("2025-01-01T00:00:00Z"), invalidAt: new Date("2026-08-31T00:00:00Z") }),
  fact("OCCASION", "Their mother's birthday in March", "2026-03-01", { attributes: { month: "mar" } }),
];
const BLOOM_FACTS: Fact[] = [fact("FAVORITE", "Eucalyptus by the armful", "2026-09-01", { entityId: "bloom" })];
const RUTH = { name: "Ruth Alder", fields: { tier: "regular", shop: "east" } };
const BLOOM = { name: "Bloom & Co", fields: { tier: "Wholesale", shop: "west" } };

interface Card {
  page: string;
  mustHonor: string[];
  ask: string | null;
}

interface Stems {
  addCustomer(shopId: string, customer: { id: string; name: string; tier?: string | null }): Promise<void>;
  addNote(shopId: string, customerId: string, text: string, options?: { at?: Date }): Promise<void>;
  card(shopId: string, customerId: string): Promise<Card | null>;
}

const shown = (value: unknown): string => JSON.stringify(value) ?? String(value);

/** Where two pages part: the first line that differs, both ways. */
function firstDifference(expected: string | null, got: string | null): string {
  if (expected === null || got === null) return `expected ${shown(expected)}, got ${shown(got)}`;
  const want = expected.split("\n");
  const have = got.split("\n");
  const line = want.findIndex((text, index) => text !== have[index]);
  const at = line === -1 ? want.length : line;
  return `line ${at + 1}: expected ${shown(want[at] ?? "(the end)")}, got ${shown(have[at] ?? "(the end)")}`;
}

async function definitionProbes(checks: Checks, lens: Lens): Promise<void> {
  await checks.run("every page reads exactly as 0.2.1 rendered it", () => {
    const pages = {
      ruth: renderBrief(lens, { entity: RUTH, summary: SUMMARY, facts: RUTH_FACTS, at: NOW }),
      ruthTight: renderBrief(lens, { entity: RUTH, summary: SUMMARY, facts: RUTH_FACTS, at: NOW, maxChars: 420 }),
      bloom: renderBrief(lens, { entity: BLOOM, summary: "", facts: BLOOM_FACTS, at: NOW }),
      nobody: renderBrief(lens, { entity: { name: "Theo", fields: {} }, summary: "", facts: [], at: NOW }),
    };
    const differ = (Object.keys(pages) as Array<keyof typeof pages>).filter((key) => pages[key] !== CAPTURED_FROM_0_2_1.pages[key]);
    ensure(differ.length === 0, differ.map((key) => `${key}'s page, ${firstDifference(CAPTURED_FROM_0_2_1.pages[key], pages[key])}`).join("\n"));
  });

  await checks.run("an order must honor what it did on 0.2.1", () => {
    const honored = mustHonorFrom(lens, RUTH_FACTS, NOW).map(({ type, fact: text }) => ({ type, fact: text }));
    ensure(shown(honored) === shown(CAPTURED_FROM_0_2_1.mustHonor), `0.2.1 honored ${shown(CAPTURED_FROM_0_2_1.mustHonor)}; this honors ${shown(honored)}`);
  });

  await checks.run("the same questions are asked, worded the same, in the same order", () => {
    const ids = (fields: Record<string, string | null>, facts: Fact[]) => gapsFor(lens, { fields }, facts, NOW).map((gap) => gap.id);
    const gaps = {
      ruth: ids(RUTH.fields, RUTH_FACTS),
      bloom: ids(BLOOM.fields, BLOOM_FACTS),
      bloomShouting: ids({ tier: " WHOLESALE " }, []),
      theo: ids({}, []),
      trade: ids({ tier: "trade" }, RUTH_FACTS.slice(5, 6)),
    };
    const differ = (Object.keys(gaps) as Array<keyof typeof gaps>).filter((key) => shown(gaps[key]) !== shown(CAPTURED_FROM_0_2_1.gaps[key]));
    ensure(differ.length === 0, differ.map((key) => `${key}: 0.2.1 asked ${shown(CAPTURED_FROM_0_2_1.gaps[key])}, this asks ${shown(gaps[key])}`).join("\n"));
    const worded = Object.fromEntries(gapsFor(lens, { fields: { tier: "wholesale" } }, [], NOW).map((gap) => [gap.id, gap.question]));
    ensure(shown(worded) === shown(CAPTURED_FROM_0_2_1.questions), `0.2.1 asked ${shown(CAPTURED_FROM_0_2_1.questions)}; this asks ${shown(worded)}`);
  });
}

async function appProbes(checks: Checks, dir: string, definitions: Definitions): Promise<void> {
  const lens = definitions.lenses[LENS]!;
  const lenses = [lens, ...Object.values(definitions.lenses).filter((other) => other.id !== LENS)];
  const loaded: { createApp?: (engine: unknown) => unknown } = {};
  const ready = await checks.run("src/app.ts exports createApp(engine), with addCustomer, addNote and card", async () => {
    const module = await importApp(dir);
    ensure(typeof module.createApp === "function", `src/app.ts exports ${Object.keys(module).join(", ") || "nothing"}, and no createApp`);
    const createApp = module.createApp as (engine: unknown) => unknown;
    const app = createApp(recording(fakeIntelligence({ lenses })).engine) as Record<string, unknown> | null;
    for (const method of ["addCustomer", "addNote", "card"]) ensure(typeof app?.[method] === "function", `createApp(engine) returned no ${method}`);
    loaded.createApp = createApp;
  });
  const createApp = loaded.createApp;
  if (!ready || !createApp) return;

  const open = () => {
    const fake = fakeIntelligence({ lenses });
    const { engine, calls } = recording(fake);
    const app = createApp(engine) as Stems;
    const placed = () => {
      const call = calls.filter((recorded) => recorded.method === "upsertEntity").at(-1);
      ensure(call, "addCustomer never put the customer on knew's roster");
      return { scope: call.args[0] as IntelligenceScope, id: (call.args[1] as { id: string }).id };
    };
    return { fake, calls, app, placed };
  };

  await checks.run("a customer nobody has noted anything about has no card", async () => {
    const { app } = open();
    await app.addCustomer("east", { id: "ruth", name: "Ruth Alder", tier: "regular" });
    const card = await app.card("east", "ruth");
    ensure(card === null, `with nothing noted, card answered ${shown(card)}`);
  });

  await checks.run("a note is read before addNote resolves, filed under its customer, and the card is knew's", async () => {
    const { fake, calls, app, placed } = open();
    await app.addCustomer("east", { id: "ruth", name: "Ruth Alder", tier: "regular" });
    const { scope, id } = placed();
    fake.script({ extraction: extraction([extracted(id, "ALLERGY", "Lilies: the cat is poisoned by them"), extracted(id, "FAVORITE", "Garden roses")]) });
    await app.addNote("east", "ruth", "No lilies ever, because of the cat. Loves garden roses.");
    const recorded = calls.find((call) => call.method === "addEpisode");
    ensure(recorded, "addNote never recorded the note with knew");
    const hints = (recorded.args[1] as { entityHints?: string[] }).entityHints ?? [];
    ensure(hints.includes(id), `the note was recorded without naming the customer it was written about (it named ${shown(hints)})`);
    const brief = await fake.brief(scope, id, { lens: LENS });
    ensure(brief, "addNote resolved with the note still unread: knew had not extracted it");
    const expected: Card = { page: brief.text, mustHonor: brief.mustHonor.map((item) => item.fact), ask: brief.gaps[0]?.question ?? null };
    const card = await app.card("east", "ruth");
    ensure(shown(card) === shown(expected), `the card should be ${shown(expected)}, and is ${shown(card)}`);
  });

  await checks.run("a wholesale customer is asked about a standing order, and a regular is not", async () => {
    const { fake, app, placed } = open();
    const asks: Record<string, string | null> = {};
    for (const [customerId, name, tier] of [["bloom", "Bloom & Co", "Wholesale"], ["ana", "Ana", "regular"]] as const) {
      await app.addCustomer("west", { id: customerId, name, tier });
      const { scope, id } = placed();
      fake.seedFacts(scope, id, [
        { type: "FAVORITE", fact: "Eucalyptus by the armful" },
        { type: "OCCASION", fact: "Opening day on 3 May", attributes: { month: "may" } },
      ]);
      asks[customerId] = (await app.card("west", customerId))?.ask ?? null;
    }
    const wholesale = CAPTURED_FROM_0_2_1.questions["standing-order"];
    const regular = CAPTURED_FROM_0_2_1.questions["who-they-send-to"];
    ensure(asks.bloom === wholesale, `a wholesale customer should be asked "${wholesale}", and was asked ${shown(asks.bloom)}: is the tier reaching knew?`);
    ensure(asks.ana === regular, `a regular should be asked "${regular}", and was asked ${shown(asks.ana)}`);
  });

  await checks.run("a shop's customers are its own", async () => {
    const { fake, calls, app, placed } = open();
    await app.addCustomer("east", { id: "ruth", name: "Ruth Alder" });
    const { scope, id } = placed();
    fake.seedFacts(scope, id, [{ type: "FAVORITE", fact: "Garden roses" }]);
    await app.addCustomer("west", { id: "bloom", name: "Bloom & Co" });
    const scopes = calls.filter((call) => call.method === "upsertEntity").map((call) => shown(call.args[0]));
    ensure(scopes[0] !== scopes[1], `the east and west shops share one customer book: ${scopes.join(" and ")}`);
    const crossed = await app.card("west", "ruth");
    ensure(crossed === null, `ruth is the east shop's customer, and the west shop's card shows ${shown(crossed)}`);
  });
}

export async function check(dir: string, options: CheckOptions): Promise<CheckResult> {
  const checks = new Checks();
  const found: { definitions?: Definitions } = {};
  await checks.run("the definitions compile, keeping the 0.x lens's name and version", () => {
    const definitions = loadDefinitions(dir);
    const { id, version } = definitions.vocabulary;
    ensure(id === LENS && version === 3, `the vocabulary is ${id}@${version}; keep regulars@3, so the episodes knew holds still name it`);
    const lens = definitions.lenses[LENS];
    ensure(lens, `there is no regulars lens; definitions/lenses holds ${Object.keys(definitions.lenses).join(", ") || "nothing"}`);
    ensure(lens.version === 3, `the regulars lens is version ${lens.version}; keep version 3`);
    found.definitions = definitions;
  });
  if (found.definitions) {
    await definitionProbes(checks, found.definitions.lenses[LENS]!);
    await appProbes(checks, dir, found.definitions);
  }
  await standardChecks(checks, dir, options);
  return checks.result();
}
