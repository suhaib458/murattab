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

const themeScript = `(function(){try{var t=localStorage.getItem("murattab-theme");if(t!=="light"&&t!=="dark"&&t!=="system"){t=null;var r=localStorage.getItem("murattab-fallback-v1");if(r){var s=JSON.parse(r);var st=s&&s.settings&&s.settings.theme;if(st==="light"||st==="dark"||st==="system"){t=st;}}}if(t==="dark"){document.documentElement.setAttribute("data-theme","dark");}else if(t==="light"){document.documentElement.removeAttribute("data-theme");}else if(t==="system"){if(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.setAttribute("data-theme","dark");}else{document.documentElement.removeAttribute("data-theme");}}}catch(e){}})();`;

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
