# Thoughtful: gifts that show you were listening

Thoughtful helps people choose gifts for the people in their life. They jot down what they hear
("Dad's really into sourdough now", "Mia already has every Ghibli film", "no alcohol, ever").
When a birthday comes up, Thoughtful shows gift picks right away if it knows enough. If it
doesn't, it asks the user one good question first, which Thoughtful writes itself.

Thoughtful is built on knew, the `@popjoker/knew` package, which is installed. knew turns notes
into what's known about each person and says what's still worth learning. You're building the part
of Thoughtful that works with it.

## What there is to know about a person

Don't write a vocabulary for people from scratch: knew comes with a general-purpose one. Start from
it, and keep its kinds of note exactly as they are, because our picks model was tuned on them. Add
one kind of note of our own:

- `WISH`: something they've said they want or would love to have.

Call the result `gifts`.

## Choosing a gift

The gift view is a lens called `gift`. Its purpose is to choose a gift they'll love. Two rules:

- **Know enough before showing picks.** Show picks first only once Thoughtful knows at least five
  things about what they love or want, in any mix: their interests, their tastes, things they've
  said they want. With four, ask first.
- **Never pick against what's known.** Anything to steer clear of, and anything they already have,
  must reach the picks model as a rule to honor, not as one more thing to consider.

## What to build

- `definitions/vocabulary.json` and `definitions/lenses/gift.json`.
- `src/app.ts`, exporting `createApp(engine)`. `engine` is Thoughtful's connection to knew, made
  once at startup and handed in. `createApp` returns an object with three methods:
  - `addPerson(userId, { id, name })`: a user adds someone they buy for.
  - `addNote(userId, personId, text, { at })`: a user writes a note about them. `at` is optional.
    It's when the note was written, and it defaults to now. By the time `addNote` resolves, the
    note has been read.
  - `firstMove(userId, personId)`: what Thoughtful does first when the user opens that person's
    gift page.
    - To ask first, it returns `{ move: "ask-first", about }`. `about` names the most useful thing
      to learn for choosing a gift, exactly as the `gift` lens labels it.
    - To show first, it returns `{ move: "show-first", page, honor }`. `page` is knew's page about
      them through the `gift` lens, exactly as knew wrote it, for the picks model to read. `honor`
      lists, in knew's words, what the picks must respect.
    - It returns `null` when the user never added the person.
- Tests in `test/` that show it works without a running knew service.

A user's people are theirs alone. knew knows Thoughtful as the client `thoughtful`.

You're done when `npm test` and `npm run typecheck` pass. Leave the compiler settings in
`tsconfig.json` as they are, and don't add dependencies.
