import type { Metadata, Viewport } from "next";
import { Alexandria } from "next/font/google";
import "./globals.css";
import "./splash.css";
import { MurattabApp } from "@/components/murattab-app";

const alexandria = Alexandria({
  subsets: ["arabic", "latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-alexandria"
});

export const metadata: Metadata = {
  title: "مرتب",
  description: "جدولك الجامعي، أوضح وأقرب إليك.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "مرتب" }
};

export const viewport: Viewport = {
  themeColor: "#103B32",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

const themeScript = `(function(){try{var t=localStorage.getItem("murattab-theme");if(t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.setAttribute("data-theme","dark");}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={alexandria.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <MurattabApp>{children}</MurattabApp>
      </body>
    </html>
  );
}
