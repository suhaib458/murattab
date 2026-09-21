"use client";

export function Splash({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="splash splash-fullscreen" role="dialog" aria-modal="true" aria-label="شاشة بدء مرتب">
      <video
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
          onDismiss();
        }}
      />
    </div>
  );
}
