import { useCallback, useEffect, useState } from "react";

/**
 * BeforeInstallPromptEvent is fired by Chrome/Edge on desktop and Android
 * when the browser considers the PWA installable. We capture it so we can
 * show a custom install button instead of relying solely on the browser menu.
 *
 * iOS Safari does not fire this event — users must use "Add to Home Screen"
 * from the Share menu manually.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

type StoredEvent = BeforeInstallPromptEvent | null;

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Returns the captured `beforeinstallprompt` event and a `promptInstall`
 * callback. On iOS the event is never fired, so `canInstall` will always be
 * false and the user should be guided to use Safari's Share → Add to Home Screen.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<StoredEvent>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    return choice.outcome === "accepted";
  }, [deferred]);

  return {
    canInstall: !!deferred && !installed,
    installed,
    promptInstall,
  };
}
