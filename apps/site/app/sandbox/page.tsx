import type { Metadata } from "next";

import { Sandbox } from "@/components/sandbox/sandbox";
import { DocHeader } from "@/components/site/page-shell";

export const metadata: Metadata = {
  title: "Sandbox",
  description:
    "Try knew's presets and your own vocabularies and lenses in the browser: add facts about an entity, the relationship and you, move time, and see the page, the needs and the next direction.",
};

export default function SandboxPage() {
  return (
    <>
      <DocHeader
        clause="Sandbox"
        title="Try the shapes."
        standfirst="Pick a starting point, then add facts, move time and change the goal. The page, the needs and the next direction come from the package itself, running in your browser. Nothing is sent anywhere, and no model is called."
      />
      <Sandbox />
    </>
  );
}
