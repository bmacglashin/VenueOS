import type { Metadata } from "next";

export { default } from "@/src/app/mission-control/layout";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Mission Control",
    template: "%s | Mission Control",
  },
  description: "Internal Venue OS operator surface for QA and demos.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};
