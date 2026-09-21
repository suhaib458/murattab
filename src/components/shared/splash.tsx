"use client";

import Image from "next/image";
import { useEffect } from "react";

const MOBILE_QUERY = "(max-width: 768px)";

export function Splash({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) return;
    const timer = window.setTimeout(onDismiss, 900);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  const finishMobileSplash = () => {
    if (window.matchMedia(MOBILE_QUERY).matches) onDismiss();
  };

  return (
    <div className="splash splash-responsive" role="dialog" aria-modal="true" aria-label="شاشة بدء مرتب">
      <div className="splash-mobile-video">
        <video
          autoPlay
          muted
          playsInline
          preload="auto"
          aria-label="فيديو هوية مرتب"
          onEnded={finishMobileSplash}
          onError={(event) => {
            const error = event.currentTarget.error;
            console.error("[Murattab Splash Video Error]", {
              code: error?.code,
              message: error?.message,
              networkState: event.currentTarget.networkState,
              readyState: event.currentTarget.readyState,
              currentSrc: event.currentTarget.currentSrc
            });
            finishMobileSplash();
          }}
        >
          <source src="/brand/splash.mp4" type="video/mp4" media={MOBILE_QUERY} />
        </video>
      </div>

      <div className="splash-desktop-static">
        <Image
          src="/brand/logo.png"
          alt="شعار مرتب"
          className="splash-logo"
          width={120}
          height={120}
          priority
        />
        <h1>مرتب</h1>
        <p className="muted">جدولك الجامعي، أوضح وأقرب إليك.</p>
      </div>
    </div>
  );
}
