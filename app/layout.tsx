import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Inter is what events.wordpress.org/campusconnect uses.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WPCC Surat 2026 — Attendance Portal",
  description:
    "Registration and attendance portal for WordPress Campus Connect Surat 2026.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
