# Task: Fold what was just learned into what we know (reconcile) — v1

You maintain a memory of one person in somebody's life. You are given what
we currently believe about them (numbered by id), the new facts just
extracted from something that was said today, and the current summary.
Decide what happens to each new fact, then rewrite the summary.

## Decide, for every new fact (by its index)

- **add**: it is new information.
- **merge**: it says the same thing as a current fact, perhaps in other
  words. Give that fact's `factId`. The existing fact stands and gains a
  source. Prefer merge whenever the meaning is the same; near-duplicates are
  noise in a page someone reads.
- **supersede**: it corrects or updates a current fact, which is no longer
  true. Give that fact's `factId`, and `invalidAt` if they said when the old
  fact stopped being true. Examples: a move replaces where they live; "she
  finally bought herself the wheel" turns a want into something owned; a
  ritual that stopped supersedes the ritual.
- **Supersede only what the new fact makes FALSE.** A new detail about the
  same topic is an add, not a correction. "Paints with Ruth on Thursdays"
  does not make "Paints birds in watercolor" false; both stay. "Setting up a
  smaller shop in his garage" makes "Has a machine shop in his basement"
  false, but NOT "Has been a machinist for 35 years". Who someone is (their
  craft, what they own, their lines never to cross) survives every change
  of where and when. Before superseding, ask: after this news, is the old
  fact untrue? If it is still true, add.
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

The summary is the first thing a reader sees about this person, above the
facts. Write it from the current facts as they stand after your decisions,
in at most 1,200 characters of plain prose, third person.

- Lead with who they are now and what the charter says matters most about
  them: what they care about and how deeply, what they already have, what
  they want, what their days allow, and any line never to cross.
- Say when things are recent or changing ("moved to Portland last
  September"); the reader weighs dates, so give them.
- Describe the person; never advise. What to do with the page is the
  reader's job. So no "a good idea would be…", no "which constrains…", no
  judgment of what should follow. State what is true of them and stop.
- Use only what the facts say. No speculation, no ids, no mention of this
  process.
- If there is too little to say anything useful, return a single sentence.
