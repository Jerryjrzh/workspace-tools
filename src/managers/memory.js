import { memoryProvider } from '../runtime/providers/MemoryProvider.js';

const MEMORY_DOMAINS = ['session', 'working', 'identity', 'soul'];

const DEFAULT_POLICY = {
  allowedSources: ['explicit', 'extracted'],
  blockedTypes: ['temp'],
  minConfidence: 0.7,
  domainPriority: {
    identity: 3,
    soul: 2,
    working: 2,
    session: 1
  },
  expirationDays: {
    location: 365,
    occupation: 730,
    project_status: 180,
    preference: null,
    fact: null
  }
};

export class MemoryManager {
  constructor(provider = memoryProvider, options = {}) {
    this.provider = provider;
    this.confidenceThreshold = options.confidenceThreshold ?? 0.7;
    this.maxRetrieve = options.maxRetrieve ?? 8;
    this.maxRecentActivity = options.maxRecentActivity ?? 6;
    this.policy = options.policy || DEFAULT_POLICY;
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

  normalizeDomain(domain = 'session') {
    return MEMORY_DOMAINS.includes(domain) ? domain : 'session';
  }

  getDomainPriority(domain = 'session') {
    const normalized = this.normalizeDomain(domain);
    return this.policy.domainPriority[normalized] || DEFAULT_POLICY.domainPriority[normalized] || 1;
  }

  createEmptyStore() {
    return {
      entries: [],
      profiles: {
        identity: [],
        soul: []
      },
      recentActivity: [],
      policies: {
        ...DEFAULT_POLICY,
        minConfidence: this.confidenceThreshold
      },
      updatedAt: new Date().toISOString()
    };
  }

  ensureStoreShape(store = {}) {
    const base = this.createEmptyStore();
    return {
      ...base,
      ...store,
      entries: Array.isArray(store.entries) ? store.entries : [],
      profiles: {
        identity: Array.isArray(store.profiles?.identity) ? store.profiles.identity : [],
        soul: Array.isArray(store.profiles?.soul) ? store.profiles.soul : []
      },
      recentActivity: Array.isArray(store.recentActivity) ? store.recentActivity : [],
      policies: {
        ...base.policies,
        ...(store.policies || {})
      }
    };
  }

  loadStore(sessionId) {
    return this.ensureStoreShape(this.load(sessionId));
  }

  saveStore(sessionId, store) {
    return this.save(sessionId, this.ensureStoreShape(store));
  }

  recordActivity(sessionId, activity) {
    const store = this.loadStore(sessionId);
    store.recentActivity = [
      {
        id: this.generateId(),
        ...activity,
        timestamp: new Date().toISOString()
      },
      ...store.recentActivity
    ].slice(0, this.maxRecentActivity);
    return this.saveStore(sessionId, store);
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
    const mergedDomain = this.getDomainPriority(incoming.domain) >= this.getDomainPriority(existing.domain)
      ? incoming.domain
      : existing.domain;
    return {
      ...existing,
      ...incoming,
      domain: mergedDomain,
      value: this.mergeValues(existing.value, incoming.value),
      confidence: Math.max(existing.confidence || 0, incoming.confidence || 0),
      updatedAt: new Date().toISOString()
    };
  }

  upsertEntry(sessionId, input = {}) {
    const store = this.loadStore(sessionId);
    const entries = [...store.entries];
    const key = input.key || this.generateKey(input.value);
    const existingIndex = entries.findIndex((entry) => entry.key === key);
    const entry = {
      id: existingIndex >= 0 ? entries[existingIndex].id : this.generateId(),
      key,
      value: input.value,
      type: input.type || 'fact',
      domain: this.normalizeDomain(input.domain || 'session'),
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
    this.saveStore(sessionId, store);
    return existingIndex >= 0 ? entries[existingIndex] : entry;
  }

  remember(sessionId, input = {}) {
    const domain = this.normalizeDomain(input.domain || 'session');
    if (domain === 'identity' || domain === 'soul') {
      return this.updateProfile(sessionId, domain, input);
    }

    return this.upsertEntry(sessionId, { ...input, domain });
  }

  forget(sessionId, keyOrId) {
    const store = this.loadStore(sessionId);
    const entryCountBefore = store.entries.length;
    store.entries = store.entries.filter(
      (entry) => entry.key !== keyOrId && entry.id !== keyOrId
    );

    for (const domain of ['identity', 'soul']) {
      store.profiles[domain] = store.profiles[domain].filter(
        (entry) => entry.key !== keyOrId && entry.id !== keyOrId
      );
    }

    const removed = entryCountBefore !== store.entries.length;
    if (removed) {
      this.saveStore(sessionId, store);
    }
    return { removed };
  }

  update(sessionId, key, updates = {}) {
    const store = this.loadStore(sessionId);
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
    this.saveStore(sessionId, store);
    return entries[index];
  }

  updateProfile(sessionId, domain, input = {}) {
    const store = this.loadStore(sessionId);
    const profile = store.profiles[domain] || [];
    const key = input.key || this.generateKey(input.value);
    const existingIndex = profile.findIndex((entry) => entry.key === key);
    const entry = {
      id: existingIndex >= 0 ? profile[existingIndex].id : this.generateId(),
      key,
      value: input.value,
      type: input.type || (domain === 'soul' ? 'preference' : 'fact'),
      domain,
      confidence: input.confidence ?? 1,
      source: input.source || 'explicit',
      createdAt: existingIndex >= 0 ? profile[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      profile[existingIndex] = this.mergeEntries(profile[existingIndex], entry);
    } else {
      profile.push(entry);
    }

    store.profiles[domain] = profile;
    this.saveStore(sessionId, store);
    return existingIndex >= 0 ? profile[existingIndex] : entry;
  }

  updateIdentity(sessionId, input = {}) {
    return this.updateProfile(sessionId, 'identity', input);
  }

  updateSoul(sessionId, input = {}) {
    return this.updateProfile(sessionId, 'soul', input);
  }

  merge(sessionId, candidate) {
    const store = this.loadStore(sessionId);
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

    if (!this.isAllowed(candidate)) {
      return { action: 'ignore', reason: 'policy_blocked', candidate };
    }

    const domain = this.normalizeDomain(candidate.domain || 'session');
    if (domain === 'identity') {
      const entry = this.updateIdentity(sessionId, { ...candidate, domain });
      return { action: 'identity', entry, candidate };
    }
    if (domain === 'soul') {
      const entry = this.updateSoul(sessionId, { ...candidate, domain });
      return { action: 'soul', entry, candidate };
    }

    const store = this.loadStore(sessionId);
    const similar = this.findSimilar(store.entries || [], candidate);
    if (!similar) {
      const entry = this.remember(sessionId, { ...candidate, source: candidate.source || 'extracted', domain });
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
    const domain = options.domain ? this.normalizeDomain(options.domain) : null;
    const store = this.loadStore(sessionId);
    const entries = domain ? store.entries.filter((entry) => entry.domain === domain) : store.entries;

    if (!query.trim()) {
      return entries
        .slice()
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, limit);
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = entries
      .map((entry) => {
        const text = `${entry.key} ${entry.value} ${entry.type} ${entry.domain}`.toLowerCase();
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

  dedupe(sessionId) {
    const store = this.loadStore(sessionId);
    const entries = store.entries || [];
    const deduped = [];
    const mergedDuplicates = [];

    for (const entry of entries) {
      const similar = deduped.find((candidate) => {
        const sameKey = (candidate.key || this.generateKey(candidate.value)) === (entry.key || this.generateKey(entry.value));
        return sameKey || this.findSimilar([candidate], entry) !== null;
      });

      if (!similar) {
        deduped.push(entry);
        continue;
      }

      const merged = this.mergeEntries(similar, entry);
      const idx = deduped.indexOf(similar);
      deduped[idx] = merged;
      mergedDuplicates.push({ kept: merged.key, mergedFrom: entry.id || entry.key });
    }

    store.entries = deduped;
    this.saveStore(sessionId, store);
    return { store, mergedDuplicates };
  }

  isAllowed(candidate) {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }

    const policies = this.policy;
    if (policies.blockedTypes.includes(candidate.type)) {
      return false;
    }
    if (candidate.source && !policies.allowedSources.includes(candidate.source)) {
      return false;
    }
    if ((candidate.confidence ?? 0) < policies.minConfidence) {
      return false;
    }
    return Boolean(candidate.value && String(candidate.value).trim());
  }

  summarizeActivity(activity = []) {
    return activity
      .slice(0, this.maxRecentActivity)
      .map((entry) => ({
        id: entry.id,
        type: entry.type || 'activity',
        summary: entry.summary || entry.value || '',
        timestamp: entry.timestamp
      }));
  }

  get policy() {
    return this._policy || { ...DEFAULT_POLICY, minConfidence: this.confidenceThreshold };
  }

  set policy(nextPolicy) {
    this._policy = {
      ...DEFAULT_POLICY,
      minConfidence: this.confidenceThreshold,
      ...(nextPolicy || {}),
      domainPriority: {
        ...DEFAULT_POLICY.domainPriority,
        ...(nextPolicy?.domainPriority || {})
      },
      expirationDays: {
        ...DEFAULT_POLICY.expirationDays,
        ...(nextPolicy?.expirationDays || {})
      }
    };
  }

  getBackgroundContext(sessionId) {
    const store = this.loadStore(sessionId);
    return {
      identity: store.profiles.identity.slice(-3),
      soul: store.profiles.soul.slice(-3),
      recentActivity: this.summarizeActivity(store.recentActivity)
    };
  }
}

export const memoryManager = new MemoryManager();
export default memoryManager;
