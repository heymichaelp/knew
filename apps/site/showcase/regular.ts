import { person } from "@popjoker/knew/presets"; // hidden
import { sketch, type Show } from "./kit"; // hidden

export default async function example(show: Show) { // hidden
  // hidden:start
  const restaurant = sketch(person.vocabulary(), [person.lens()], [
    {
      note: "Shellfish allergy",
      about: "Dana",
      facts: [
        { type: "AVOID", fact: "Allergic to shellfish." },
        { type: "PLAN", fact: "Coming in Friday for her mum's 70th.", validAt: "2026-10-16" },
      ],
    },
  ]);
  // hidden:end
  // A lens is a goal. The host's puts the next visit first.
  restaurant.lens("hospitality", {
    goal: "Make their next visit feel like it was planned for them.",
    weigh: { "Steer clear of": 10, "Coming up": 5, "What they love": 3 },
  });

  const dana = restaurant.person("Dana");
  await dana.note("Dana's back Friday for her mum's 70th. Shellfish allergy, so no clams.");

  // On every page, whatever else is known.
  show(await dana.mustHonor());

  // The same guest, two goals: what's worth learning next differs.
  show(await dana.next("hospitality"));
  show(await dana.next("know-them"));
} // hidden
