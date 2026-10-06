# Stems: bring our customer book to knew 1.0

Stems is the app our florist shops use to keep track of their regulars. Staff write quick notes
about customers ("allergic to lilies", "anniversary is 14 June", "leave it with the neighbour").
Before taking an order, they read the customer's card: knew's page about the customer, what the
order must honor, and the one question worth asking next.

We built Stems on knew 0.2.1. The `@popjoker/knew` installed here is the coming 1.0, still
versioned 0.2.1 until it's released. 1.0 changes how a lens is written and renames parts of the
API. Bring Stems to 1.0 without changing anything our staff see.

Two things from the 0.2.1 days are in `inputs/`:

- `inputs/legacy-lens.json`: our lens, `regulars`, at version 3, exactly as we registered it with
  knew 0.2.1.
- `inputs/app-0.2.ts`: our app, written against 0.2.1.

## What to build

- `definitions/vocabulary.json` and `definitions/lenses/regulars.json`: our lens, moved to 1.0.
  - Keep its name, `regulars`, and its version, 3, so the notes knew already holds still point
    at it.
  - Every customer's card must read exactly as it did on 0.2.1, byte for byte, and ask the same
    questions in the same order.
- `src/app.ts`: the app, brought to 1.0. It still exports `createApp(engine)`, and its methods
  keep their names and behave exactly as they did.
- Tests in `test/` that show it works without a running knew service.

You're done when `npm test` and `npm run typecheck` pass. Leave the compiler settings in
`tsconfig.json` as they are, and don't add dependencies.
