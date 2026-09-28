"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef } from "react";

const MOBILE_QUERY = "(max-width: 768px)";
const MOBILE_SPLASH_FAILSAFE_MS = 10_000;

export function Splash({ onDismiss }: { onDismiss: () => void }) {
  const dismissedRef = useRef(false);

  const finishSplash = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) {
      // iOS Safari can occasionally leave a media element buffering/stalled
      // without firing either `ended` or `error`. Keep the normal video
      // experience untouched, but never let the splash become an infinite gate.
      const failsafe = window.setTimeout(finishSplash, MOBILE_SPLASH_FAILSAFE_MS);
      return () => window.clearTimeout(failsafe);
    }

    const timer = window.setTimeout(finishSplash, 900);
    return () => window.clearTimeout(timer);
  }, [finishSplash]);

  const finishMobileSplash = () => {
    if (window.matchMedia(MOBILE_QUERY).matches) finishSplash();
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
          onAbort={finishMobileSplash}
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
