import type { Metadata } from "next";
import { Geist_Mono, Lato, Passion_One } from "next/font/google";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { UnlessHome } from "@/components/site/scroll-header";
import "./globals.css";

/*
  Passion One for anything that speaks: the wordmark and the headings, round and
  heavy, black on white. Lato carries the reading, soft and humanist. Geist Mono
  appears in code and nowhere else — labels and dates are set in the reading face.
*/
const passionOne = Passion_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-passion-one",
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
    default: "knew — the relationship engine",
    template: "%s — knew",
  },
  description:
    "There's no substitute for paying attention. But when you do, knew invests it, and it pays dividends in your relationships: notes become dated facts by dimension, and for a goal it reports what is understood, what is missing, and the most valuable direction next.",
  openGraph: {
    title: "knew — the relationship engine",
    description: "Attention, invested.",
    url: "https://knew.dev",
    siteName: "knew",
    type: "website",
  },
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" className={`${passionOne.variable} ${lato.variable} ${geistMono.variable}`}>
      <body>
        <UnlessHome>
          <SiteHeader />
        </UnlessHome>
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
