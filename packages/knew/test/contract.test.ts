import { test } from "node:test";
import { contractSuite, fakeIntelligence } from "../src/testing.ts";

/**
 * The fake passes the contract: a client's tests against it mean what tests
 * against the service would. Each case gets its own fake, so nothing leaks.
 */

let n = 0;
contractSuite({
  test,
  scripted: true,
  open: async () => {
    const fake = fakeIntelligence();
    n += 1;
    return {
      intelligence: fake,
      scope: { clientId: "fake", subjectId: `subject-${n}` },
      otherScope: { clientId: "fake", subjectId: `subject-${n}-other` },
      script: (turn) => fake.script(turn),
      close: async () => {},
    };
  },
});
