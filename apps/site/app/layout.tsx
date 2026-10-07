import type { Metadata } from "next";
import { Geist_Mono, Lato, Playfair_Display } from "next/font/google";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import "./globals.css";

/*
  Playfair Display for anything that speaks: a high-contrast serif with thin,
  almost drawn strokes — romantic rather than official. Lato carries the reading,
  soft and humanist and unhurried. The pairing is Figma's own (Playfair and Lato
  both sit in its Josefin Sans palette). Geist Mono appears in code and nowhere
  else — labels and dates are set in the reading face, so the page stays soft.
*/
const playfair = Playfair_Display({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});

const lato = Lato({
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  style: ["normal", "italic"],
  variable: "--font-lato",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://knew.dev"),
  title: {
    default: "knew — the attention engine",
    template: "%s — knew",
  },
  description:
    "knew turns notes into dated facts organised by dimensions of understanding, and reports, for a goal, what is understood, what is missing, and the most valuable direction next.",
  openGraph: {
    title: "knew — the attention engine",
    description: "Understanding, by dimension, and where it should go next.",
    url: "https://knew.dev",
    siteName: "knew",
    type: "website",
  },
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${lato.variable} ${geistMono.variable}`}>
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
