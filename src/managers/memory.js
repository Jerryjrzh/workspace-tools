import { memoryProvider } from '../runtime/providers/MemoryProvider.js';

export class MemoryManager {
  constructor(provider = memoryProvider, options = {}) {
    this.provider = provider;
    this.confidenceThreshold = options.confidenceThreshold ?? 0.7;
    this.maxRetrieve = options.maxRetrieve ?? 8;
  }

  load(sessionId) {
    return this.provider.load(sessionId);
  }

  save(sessionId, store) {
    return this.provider.save(sessionId, store);
  }

  generateId() {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  generateKey(value) {
    const slug = String(value || 'memory')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
    return slug || 'memory';
  }

  findByKey(entries, key) {
    return entries.find((entry) => entry.key === key) || null;
  }

  findById(entries, id) {
    return entries.find((entry) => entry.id === id) || null;
  }

  findSimilar(entries, candidate) {
    const key = candidate.key || this.generateKey(candidate.value);
    const byKey = this.findByKey(entries, key);
    if (byKey) {
      return byKey;
    }

    const value = String(candidate.value || '').toLowerCase();
    return entries.find((entry) => {
      const existing = String(entry.value || '').toLowerCase();
      if (existing.includes(value) || value.includes(existing)) {
        return true;
      }

      if (entry.type && candidate.type && entry.type === candidate.type) {
        const existingTokens = new Set(existing.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter((token) => token.length > 2));
        const candidateTokens = value.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter((token) => token.length > 2);
        const overlap = candidateTokens.filter((token) => existingTokens.has(token));
        return overlap.length >= 2;
      }

      return false;
    }) || null;
  }

  isConflict(existing, candidate) {
    const existingValue = String(existing.value || '').toLowerCase();
    const candidateValue = String(candidate.value || '').toLowerCase();
    if (!existingValue || !candidateValue) {
      return false;
    }
    return existingValue !== candidateValue;
  }

  mergeValues(existingValue, candidateValue) {
    const existing = String(existingValue || '').trim();
    const candidate = String(candidateValue || '').trim();
    if (!existing) {
      return candidate;
    }
    if (!candidate || existing.includes(candidate)) {
      return existing;
    }
    if (candidate.includes(existing)) {
      return candidate;
    }
    return `${candidate} (${existing})`;
  }

  mergeEntries(existing, incoming) {
    return {
      ...existing,
      ...incoming,
      value: this.mergeValues(existing.value, incoming.value),
      confidence: Math.max(existing.confidence || 0, incoming.confidence || 0),
      updatedAt: new Date().toISOString()
    };
  }

  remember(sessionId, input = {}) {
    const store = this.load(sessionId);
    const entries = [...(store.entries || [])];
    const key = input.key || this.generateKey(input.value);
    const existingIndex = entries.findIndex((entry) => entry.key === key);
    const entry = {
      id: existingIndex >= 0 ? entries[existingIndex].id : this.generateId(),
      key,
      value: input.value,
      type: input.type || 'fact',
      confidence: input.confidence ?? 1,
      source: input.source || 'explicit',
      createdAt: existingIndex >= 0 ? entries[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      entries[existingIndex] = this.mergeEntries(entries[existingIndex], entry);
    } else {
      entries.push(entry);
    }

    store.entries = entries;
    this.save(sessionId, store);
    return existingIndex >= 0 ? entries[existingIndex] : entry;
  }

  forget(sessionId, keyOrId) {
    const store = this.load(sessionId);
    const entries = store.entries || [];
    const nextEntries = entries.filter(
      (entry) => entry.key !== keyOrId && entry.id !== keyOrId
    );

    if (nextEntries.length === entries.length) {
      return { removed: false };
    }

    store.entries = nextEntries;
    this.save(sessionId, store);
    return { removed: true };
  }

  update(sessionId, key, updates = {}) {
    const store = this.load(sessionId);
    const entries = store.entries || [];
    const index = entries.findIndex((entry) => entry.key === key || entry.id === key);
    if (index < 0) {
      return null;
    }

    entries[index] = {
      ...entries[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    store.entries = entries;
    this.save(sessionId, store);
    return entries[index];
  }

  merge(sessionId, candidate) {
    const store = this.load(sessionId);
    const similar = this.findSimilar(store.entries || [], candidate);
    if (!similar) {
      return this.remember(sessionId, candidate);
    }

    return this.update(sessionId, similar.key, {
      value: this.mergeValues(similar.value, candidate.value),
      confidence: Math.max(similar.confidence || 0, candidate.confidence || 0),
      type: candidate.type || similar.type,
      source: candidate.source || similar.source
    });
  }

  processCandidate(sessionId, candidate = {}) {
    const confidence = candidate.confidence ?? 0;
    if (confidence < this.confidenceThreshold) {
      return { action: 'ignore', reason: 'low_confidence', candidate };
    }

    const store = this.load(sessionId);
    const similar = this.findSimilar(store.entries || [], candidate);
    if (!similar) {
      const entry = this.remember(sessionId, { ...candidate, source: candidate.source || 'extracted' });
      return { action: 'save', entry, candidate };
    }

    if (this.isConflict(similar, candidate)) {
      const entry = this.update(sessionId, similar.key, {
        value: candidate.value,
        confidence: Math.max(similar.confidence || 0, candidate.confidence || 0),
        type: candidate.type || similar.type,
        source: candidate.source || 'extracted'
      });
      return { action: 'update', entry, candidate };
    }

    const entry = this.merge(sessionId, candidate);
    return { action: 'merge', entry, candidate };
  }

  search(sessionId, query = '', options = {}) {
    const limit = options.limit ?? this.maxRetrieve;
    const store = this.load(sessionId);
    const entries = store.entries || [];

    if (!query.trim()) {
      return entries
        .slice()
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, limit);
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = entries
      .map((entry) => {
        const text = `${entry.key} ${entry.value} ${entry.type}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (text.includes(term)) {
            score += 1;
          }
        }
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return String(b.entry.updatedAt).localeCompare(String(a.entry.updatedAt));
      });

    if (scored.length === 0) {
      return entries
        .slice()
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, limit);
    }

    return scored.slice(0, limit).map((item) => item.entry);
  }
}

export const memoryManager = new MemoryManager();
export default memoryManager;
