import { person } from "@popjoker/knew/presets"; // hidden
import { sketch, type Show } from "./kit"; // hidden

export default async function example(show: Show) { // hidden
  // hidden:start
  const knew = sketch(person.vocabulary(), [person.lens()], [
    {
      note: "training for the Leeds marathon",
      about: "Mia",
      facts: [
        { type: "PLAN", fact: "Running the Leeds marathon in April.", validAt: "2027-04" },
        { type: "MENTIONED", fact: "Her knee has been playing up." },
        { type: "HISTORY", fact: "You met at university." },
      ],
    },
    {
      note: "physio",
      about: "Mia",
      facts: [{ type: "WORK", fact: "A physio at Leeds General, mostly sports injuries." }],
    },
  ]);
  const yourApp = { askAbout: (next?: string[]) => (next?.[0] === "Work" ? "What's Mia doing for work these days?" : "") };
  // hidden:end
  const mia = knew.person("Mia");
  await mia.note("Coffee with Mia. She's training for the Leeds marathon in April and her knee's playing up. We met at uni.");

  show(await mia.page());

  // What's missing, most valuable first.
  show(await mia.next());

  // knew reports what's missing. What to do about it is your app's call.
  show(yourApp.askAbout(await mia.next()));

  // You find out, and write it down. What's next moves on.
  await mia.note("Mia's a physio at Leeds General now, mostly sports injuries.");
  show(await mia.next());
} // hidden
