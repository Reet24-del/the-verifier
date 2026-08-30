const STORAGE_KEY = 'the-verifier-conversation-id';

export function createConversationStorage(storage = globalThis.sessionStorage) {
  return {
    read() {
      try {
        return storage?.getItem(STORAGE_KEY) || null;
      } catch {
        return null;
      }
    },
    write(conversationId) {
      try {
        storage?.setItem(STORAGE_KEY, conversationId);
      } catch {
        // Typed and voice conversation continue even when storage is unavailable.
      }
    },
    clear() {
      try {
        storage?.removeItem(STORAGE_KEY);
      } catch {
        // A blocked storage API must not block a new conversation.
      }
    },
  };
}
