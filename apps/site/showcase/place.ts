import { place } from "@popjoker/knew/presets"; // hidden
import { sketch, type Show } from "./kit"; // hidden

export default async function example(show: Show) { // hidden
  // hidden:start
  const knew = sketch(place.vocabulary(), [place.lens()], [
    {
      note: "First night at The Vault",
      about: "The Vault",
      facts: [
        { type: "KIND", fact: "A tiny basement jazz club." },
        { type: "LOCATION", fact: "Down the stairs behind the record shop on Dean Street." },
        { type: "CAUTION", fact: "Cash only." },
        { type: "OFFER", fact: "A jam session on Tuesdays." },
        { type: "ATMOSPHERE", fact: "Dark, loud, and everyone faces the stage." },
        { type: "VISIT", fact: "First went for the Tuesday jam.", validAt: "2026-03-03" },
      ],
    },
    {
      note: "Sam behind the bar",
      about: "The Vault",
      facts: [
        { type: "CONTACT", fact: "Sam, behind the bar, saves you a stool by the piano." },
        { type: "BUSY", fact: "Thursday is the night: the trio, and a full room by nine." },
        { type: "OFFER", fact: "The Thursday trio." },
      ],
    },
  ]);
  const yourApp = {
    askAbout: (due?: string[]) => (due?.includes("What's on offer") ? "Is the Thursday trio still playing?" : ""),
  };
  // hidden:end
  const vault = knew.place("The Vault");

  // The first night, you notice the basics. knew points at what you haven't noticed yet.
  await vault.note("First night at The Vault: a basement behind the record shop on Dean Street. Cash only. Tuesday jam, dark and loud.", { on: "2026-03-03" });
  show(await vault.next());

  // A few visits in, you've noticed exactly those.
  await vault.note("Sam behind the bar saved me a stool by the piano. Thursday's the night: the trio, and it's full by nine.", { on: "2026-04-16" });
  show(await vault.next());

  // By autumn, what's on and when it's busy may have changed.
  show(await vault.revisit({ on: "2026-11-01" }));
  show(yourApp.askAbout(await vault.revisit({ on: "2026-11-01" })));
} // hidden
