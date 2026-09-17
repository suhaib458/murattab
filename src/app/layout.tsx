import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./splash.css";

export const metadata: Metadata = { title: "مرتب", description: "جدولك الجامعي، أوضح وأقرب إليك.", manifest: "/manifest.webmanifest", appleWebApp: { capable: true, title: "مرتب" } };
export const viewport: Viewport = { themeColor: "#103B32", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ar" dir="rtl" suppressHydrationWarning><body>{children}</body></html>; }
