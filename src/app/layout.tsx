import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Fraunces } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});
// Display serif for headlines — the organic, botanical counterpoint to Geist's
// engineering voice. Self-hosted at build by next/font (no runtime requests).
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Tree EDU — Problem-Mastery Learning",
  description:
    "Bring one specific problem — grow a living tree of understanding around it. Taught 1-on-1 by an AI mentor, proven through checkpoints, recorded in your portfolio.",
};

// viewport-fit=cover enables env(safe-area-inset-*) so the mobile bottom nav
// clears the iOS home indicator and the immersive chat can extend edge-to-edge.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
