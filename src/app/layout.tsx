import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SLAPulse",
  description: "Automated SLA compliance evidence pipeline",
};

// Deliberately minimal: staff chrome (NavBar, role switcher) lives in
// src/app/(staff)/layout.tsx, not here -- the Trust Portal
// (src/app/portal/*) shares this root layout and must stay free of
// SLAPulse's internal staff UI (PF1).
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
