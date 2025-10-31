import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pi42 Quant Intelligence",
  description:
    "Comprehensive quant analytics, live market structure, and API explorer for the Pi42 derivatives exchange.",
  metadataBase: new URL("https://agentic-3c488d1a.vercel.app"),
  keywords: [
    "Pi42",
    "crypto",
    "derivatives",
    "quant",
    "market data",
    "Indian crypto futures",
  ],
  openGraph: {
    title: "Pi42 Quant Intelligence Dashboard",
    description:
      "Live market intelligence, depth visualisations, and API tooling for Pi42.",
    type: "website",
    url: "https://agentic-3c488d1a.vercel.app",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pi42 Quant Intelligence Dashboard",
    description: "Monitor Pi42 futures markets with live analytics.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="noise" />
        {children}
      </body>
    </html>
  );
}
