import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fin Advisor – Personal Portfolio Tracker (Educational)",
  description: "Educational portfolio analysis & AI-powered insights. Not financial advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

