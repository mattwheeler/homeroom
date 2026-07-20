import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./calm-momentum.css";

export const metadata: Metadata = {
  title: "Homeroom — AI that helps students stay ahead",
  description: "A guardian-connected AI workspace designed for K–12 students."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
