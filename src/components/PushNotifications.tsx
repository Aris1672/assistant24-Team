"use client";

import { useEffect, useState } from "react";
import { pushSupported, urlBase64ToUint8Array } from "@/lib/push";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Status = "unsupported" | "checking" | "prompt" | "subscribing" | "granted" | "denied";

// Small banner in the sidebar that offers to turn on push notifications
// (used when the app is installed as a home-screen PWA on a phone, but
// works the same in a desktop browser tab). Notification permission can
// only be requested from a real user gesture, so this can't auto-subscribe
// silently on first load — it shows a button instead. Once granted, it
// re-subscribes quietly on every mount in case the browser's push
// subscription rotated (this does happen occasionally) or a previous
// subscribe call didn't reach the server.
export default function PushNotifications() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    if (!pushSupported()) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    if (Notification.permission === "granted") {
      subscribe(false);
    } else {
      setStatus("prompt");
    }
  }, []);

  async function subscribe(fromClick: boolean) {
    try {
      if (fromClick) setStatus("subscribing");

      const permission =
        Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "prompt");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
          console.error("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set — push notifications are disabled.");
          setStatus("prompt");
          return;
        }
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }

      const json = subscription.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });

      setStatus("granted");
    } catch (err) {
      console.error("Push subscribe failed:", err);
      setStatus("prompt");
    }
  }

  if (status !== "prompt" && status !== "subscribing") return null;

  return (
    <div className="mx-4 mb-3 flex items-center justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">
      <span>{t("enableNotificationsBody")}</span>
      <button
        onClick={() => subscribe(true)}
        disabled={status === "subscribing"}
        className="shrink-0 rounded-md bg-indigo-600 px-2 py-1 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {status === "subscribing" ? t("enabling") : t("enableNotifications")}
      </button>
    </div>
  );
}
