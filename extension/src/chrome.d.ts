// Minimal ambient declarations for the Chrome extension APIs this extension
// uses. Hand-rolled to avoid an @types/chrome install (npm is proxy-blocked on
// the dev machine). Extend only as new API surface is actually used.

declare namespace chrome {
  namespace runtime {
    function sendMessage(message: unknown): void;
    const onMessage: {
      addListener(
        callback: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void,
      ): void;
    };
  }

  namespace storage {
    interface StorageArea {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const session: StorageArea;
    const local: StorageArea;
  }

  namespace action {
    function setBadgeText(details: { text: string }): void;
  }
}
