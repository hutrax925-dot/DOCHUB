const assert = require('assert');
const { sanitizeAiConfigForStorage, readPersistedAiApiKey, getAiInputAttributes } = require('../ai_config_utils.js');

const sanitized = sanitizeAiConfigForStorage({ apiKey: 'secret', model: 'gpt-4', provider: 'openai' });
assert.strictEqual(sanitized.apiKey, undefined);
assert.strictEqual(sanitized.model, 'gpt-4');
assert.strictEqual(sanitized.provider, 'openai');

const storage = {
  getItem(key) {
    if (key === 'dochub-ai-api-key') return 'persisted-key';
    return null;
  },
  setItem() {}
};
const sessionStorage = {
  getItem() { return null; },
  setItem() {}
};
assert.strictEqual(readPersistedAiApiKey(storage, sessionStorage), 'persisted-key');

const attrs = getAiInputAttributes();
assert.strictEqual(attrs.type, 'text');
assert.strictEqual(attrs.autocomplete, 'off');
assert.strictEqual(attrs.spellcheck, 'false');

console.log('AI config regression checks passed');
