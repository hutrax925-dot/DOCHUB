function sanitizeAiConfigForStorage(config = {}) {
  if (!config || typeof config !== 'object') return {};
  const sanitized = { ...config };
  delete sanitized.apiKey;
  return sanitized;
}

function readPersistedAiApiKey(storage = null, sessionStorageRef = null) {
  const localStore = storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  const sessionStore = sessionStorageRef || (typeof globalThis !== 'undefined' ? globalThis.sessionStorage : null);

  if (!localStore && !sessionStore) return '';

  const persistedSession = sessionStore?.getItem?.('dochub-ai-api-key') || '';
  if (persistedSession) return persistedSession;

  const persistedLocal = localStore?.getItem?.('dochub-ai-api-key') || '';
  if (persistedLocal) {
    sessionStore?.setItem?.('dochub-ai-api-key', persistedLocal);
    return persistedLocal;
  }

  return '';
}

function getAiInputAttributes() {
  return {
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    inputmode: 'text'
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sanitizeAiConfigForStorage, readPersistedAiApiKey, getAiInputAttributes };
}

if (typeof window !== 'undefined') {
  window.sanitizeAiConfigForStorage = sanitizeAiConfigForStorage;
  window.readPersistedAiApiKey = readPersistedAiApiKey;
  window.getAiInputAttributes = getAiInputAttributes;
}
