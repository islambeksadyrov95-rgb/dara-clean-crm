import type { Metadata } from "next";
// Self-hosted Geist (npm `geist`) instead of next/font/google — no Google Fonts fetch at build
// time (it was flaky in CI), fonts ship with the bundle. Same CSS vars (--font-geist-sans/mono).
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "Dara Clean CRM",
  description: "CRM повторных продаж для химчистки ковров Dara Clean",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
