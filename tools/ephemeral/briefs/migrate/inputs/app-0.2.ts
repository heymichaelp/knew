import { randomUUID } from "node:crypto";
import type { IntelligenceScope, PeopleIntelligence } from "@popjoker/knew";

/**
 * Stems' side of knew, written against @popjoker/knew 0.2.1: each shop's
 * customers, the notes its staff write about them, and the card staff read
 * before taking an order. Every call is scoped to the shop, so one shop's
 * customer book never reads another's.
 */

export interface Customer {
  id: string;
  name: string;
  /** "regular", "wholesale", "trade" and so on, as the shop's till has it. */
  tier?: string | null;
}

export interface Card {
  /** knew's page about the customer. */
  page: string;
  /** What the order must honor, word for word. */
  mustHonor: string[];
  /** The question worth asking them next, if there is one. */
  ask: string | null;
}

export function createApp(intelligence: PeopleIntelligence) {
  const scope = (shopId: string): IntelligenceScope => ({ clientId: "stems", subjectId: shopId });

  return {
    async addCustomer(shopId: string, customer: Customer): Promise<void> {
      await intelligence.upsertPerson(scope(shopId), { id: customer.id, name: customer.name, fields: { tier: customer.tier ?? null } });
    },

    async addNote(shopId: string, customerId: string, text: string, options: { at?: Date } = {}): Promise<void> {
      const sourceRef = randomUUID();
      await intelligence.addEpisode(scope(shopId), {
        source: "note",
        sourceRef,
        content: text,
        personHints: [customerId],
        referenceAt: options.at ?? new Date(),
        extract: "inline",
      });
      // Staff read the card right after writing a note, so the note is read now.
      await intelligence.extractNow(scope(shopId), { maxEpisodes: 5, askedSourceRef: sourceRef });
    },

    /** Null until something is known about the customer: the till shows its own notes instead. */
    async card(shopId: string, customerId: string): Promise<Card | null> {
      const brief = await intelligence.brief(scope(shopId), customerId);
      if (!brief) return null;
      return { page: brief.text, mustHonor: brief.mustHonor.map((item) => item.fact), ask: brief.gaps[0]?.question ?? null };
    },
  };
}
