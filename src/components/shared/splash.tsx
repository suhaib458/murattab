"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export function Splash({ onDismiss }: { onDismiss: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);

  // The splash video is the first visual frame on every device.
  // Keep a generous watchdog only for a genuinely stalled media element.
  useEffect(() => {
    if (videoFailed) return;
    const watchdog = window.setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.ended) {
        console.warn("[Murattab] Splash video watchdog released a stalled splash.");
        onDismiss();
      }
    }, 15000);
    return () => window.clearTimeout(watchdog);
  }, [videoFailed, onDismiss]);

  useEffect(() => {
    if (videoFailed) return;
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch((error: unknown) => {
      console.warn("[Murattab] Splash autoplay failed:", error);
      setVideoFailed(true);
    });
  }, [videoFailed]);

  if (videoFailed) {
    return (
      <div className="splash splash-fallback" role="dialog" aria-modal="true" aria-label="شاشة بدء مرتب">
        <Image
          src="/brand/logo.png"
          alt="شعار مرتب"
          className="splash-logo"
          width={120}
          height={120}
          priority
          onLoad={() => window.setTimeout(onDismiss, 900)}
        />
      </div>
    );
  }

  return (
    <div className="splash splash-fullscreen" role="dialog" aria-modal="true" aria-label="شاشة بدء مرتب">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        preload="auto"
        src="/brand/splash.mp4"
        aria-label="فيديو هوية مرتب"
        onEnded={onDismiss}
        onError={(event) => {
          const error = event.currentTarget.error;
          console.error("[Murattab Splash Video Error]", {
            code: error?.code,
            message: error?.message,
            networkState: event.currentTarget.networkState,
            readyState: event.currentTarget.readyState,
            currentSrc: event.currentTarget.currentSrc
          });
          setVideoFailed(true);
        }}
      />
    </div>
  );
}
