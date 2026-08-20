import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AVTOSH.AZ",
  description:
    "Azərbaycanda avtomobil və motosiklet elanları — AVTOSH.AZ marketplace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="az">
      <body className="antialiased">{children}</body>
    </html>
  );
}
