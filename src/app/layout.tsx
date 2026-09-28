import type { Metadata, Viewport } from "next";
import { Alexandria } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
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
  appleWebApp: { capable: true, title: "مرتب" },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png"
  },
  openGraph: {
    title: "مرتب",
    description: "جدولك الجامعي، أوضح وأقرب إليك.",
    locale: "ar",
    type: "website"
  }
};

export const viewport: Viewport = {
  themeColor: "#7A1827",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

const themeScript = `(function(){try{var t=localStorage.getItem("murattab-theme");if(t!=="light"&&t!=="dark"&&t!=="system"){t=null;var r=localStorage.getItem("murattab-fallback-v1");if(r){var s=JSON.parse(r);var st=s&&s.settings&&s.settings.theme;if(st==="light"||st==="dark"||st==="system"){t=st;}}}if(t==="dark"){document.documentElement.setAttribute("data-theme","dark");}else if(t==="light"){document.documentElement.removeAttribute("data-theme");}else if(t==="system"){if(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.setAttribute("data-theme","dark");}else{document.documentElement.removeAttribute("data-theme");}}}catch(e){}})();`;

const startupRecoveryScript = `(function(){var KEY="murattab-splash-recovery-v1";var WAIT=15000;function clearRecovery(){try{sessionStorage.removeItem(KEY);}catch(e){}}function showRetry(splash){while(splash.firstChild){splash.removeChild(splash.firstChild);}splash.style.display="flex";splash.style.alignItems="center";splash.style.justifyContent="center";splash.style.padding="24px";splash.style.background="#0d0809";splash.style.color="#fff";var box=document.createElement("div");box.style.maxWidth="360px";box.style.width="100%";box.style.textAlign="center";box.style.fontFamily="system-ui,-apple-system,sans-serif";var title=document.createElement("h1");title.textContent="تعذّر تحميل مرتب";title.style.fontSize="1.35rem";title.style.margin="0 0 10px";var message=document.createElement("p");message.textContent="الاتصال انقطع أثناء تحميل التطبيق. جرّب إعادة التحميل.";message.style.margin="0 0 18px";message.style.lineHeight="1.7";message.style.opacity=".82";var button=document.createElement("button");button.type="button";button.textContent="إعادة المحاولة";button.style.minHeight="44px";button.style.padding="10px 20px";button.style.border="0";button.style.borderRadius="999px";button.style.background="#7A1827";button.style.color="#fff";button.style.font="inherit";button.style.fontWeight="700";button.addEventListener("click",function(){clearRecovery();location.reload();});box.appendChild(title);box.appendChild(message);box.appendChild(button);splash.appendChild(box);}window.setTimeout(function(){var splash=document.querySelector('[data-murattab-splash="true"]');if(!splash){clearRecovery();return;}if(splash.getAttribute("data-client-ready")==="true"){clearRecovery();return;}var attempts=0;var canPersist=false;try{attempts=Number(sessionStorage.getItem(KEY)||"0");if(!Number.isFinite(attempts)||attempts<0){attempts=0;}if(attempts<1){sessionStorage.setItem(KEY,"1");canPersist=true;}}catch(e){}if(attempts<1&&canPersist){location.reload();return;}showRetry(splash);},WAIT);})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={alexandria.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: startupRecoveryScript }} />
      </head>
      <body>
        <MurattabApp>{children}</MurattabApp>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
