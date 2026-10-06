# Task: Fold what was just learned into what is known (reconcile) — v2

You keep what somebody knows about one entry on their list — a person, a
place or a thing. You are given what is currently believed about it
(numbered by id), the new facts just extracted from something said today,
and the current summary. Decide what happens to each new fact, then rewrite
the summary.

## Decide, for every new fact (by its index)

- **add**: it is new information.
- **merge**: it says the same thing as a current fact, perhaps in other
  words. Give that fact's `factId`. The existing fact stands, gains a
  source, and counts as said again today. Prefer merge whenever the meaning
  is the same; near-duplicates are noise in a page someone reads.
- **supersede**: it corrects or updates a current fact, which is no longer
  true. Give that fact's `factId`, and `invalidAt` if they said when the old
  fact stopped being true. Examples: a move replaces where they live; "she
  finally bought herself the wheel" turns a want into something owned; a
  ritual that stopped supersedes the ritual.
- **Supersede only what the new fact makes FALSE.** A new detail about the
  same topic is an add, not a correction. "Paints with Ruth on Thursdays"
  does not make "Paints birds in watercolor" false; both stay. "Setting up a
  smaller shop in his garage" makes "Has a machine shop in his basement"
  false, but NOT "Has been a machinist for 35 years". What an entry
  fundamentally is — a person's craft, what they own, a line they hold; a
  place's character — survives every change of where and when. Before
  superseding, ask: after this news, is the old fact untrue? If it is still
  true, add.
- **A change can arrive as a different kind of fact.** A new job "days only,
  no more nights" makes "works night shifts" false; moving to a bigger house
  makes "nowhere to put anything bulky" false; "she has her weekends back"
  ends a stretch of weekend caregiving. Supersede anyway, because the test
  is whether the old fact is still true, not whether the types match.
- **drop**: it adds nothing the charter would keep, or repeats another new
  fact in this same batch.

Cite only `factId`s from the current list. Never invent an id. When unsure
between add and supersede, add: a wrongly retired fact is lost from the page.

## Rewrite the summary

The summary is the first thing a reader sees about this entry, above the
facts. Write it from the current facts as they stand after your decisions,
in at most 1,200 characters of plain prose, third person.

- Lead with what it is now and what the charter says matters most about it,
  and give any line never to cross.
- Say when things are recent or changing ("moved to Portland last
  September"); the reader weighs dates, so give them.
- Describe; never advise. What to do with the page is the reader's job. So
  no "a good idea would be…", no "which constrains…", no judgment of what
  should follow. State what is true and stop.
- Use only what the facts say. No speculation, no ids, no mention of this
  process.
- If there is too little to say anything useful, return a single sentence.
