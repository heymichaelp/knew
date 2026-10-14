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
      directions: [
        { dimension: "work", label: "What she does for work" },
        { dimension: "people", label: "Whether she has a partner" },
        { dimension: "background", label: "Where she grew up" },
      ],
    },
    {
      note: "physio",
      about: "Mia",
      facts: [
        { type: "WORK", fact: "A physio at Leeds General, mostly sports injuries." },
        { type: "ORIGIN", fact: "Grew up in Denver." },
      ],
      answers: { "What she does for work": "A physio at Leeds General, mostly sports injuries.", "Where she grew up": "Grew up in Denver." },
      directions: [
        { dimension: "people", label: "Whether her family is still in Denver", from: ["Grew up in Denver."] },
        { dimension: "pursuits", label: "Whether she follows the Broncos", from: ["Grew up in Denver."] },
      ],
    },
  ]);
  const yourApp = { askAbout: (next?: string[]) => (next?.[0] === "What she does for work" ? "What's Mia doing for work these days?" : "") };
  // hidden:end
  const mia = knew.person("Mia");
  await mia.note("Coffee with Mia. She's training for the Leeds marathon in April and her knee's playing up. We met at uni.");

  show(await mia.page());

  // What to learn next: specific things, proposed from what's known.
  show(await mia.next());

  // knew names the direction. The question is your app's.
  show(yourApp.askAbout(await mia.next()));

  // A week on, two are answered, and Denver opens a thread.
  await mia.note("Mia's a physio at Leeds General now. She grew up in Denver, came over for uni and stayed.");
  show(await mia.next());
} // hidden
