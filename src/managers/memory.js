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
    fact: null,
    instruction: null
  },
  backgroundLimit: {
    identity: 3,
    soul: 3,
    working: 5,
    session: 5
  },
  // Global store budget (P2-L2): prevent unbounded growth in long sessions.
  maxEntries: 500,          // hard cap on store.entries total count
  maxEntryChars: 2000,      // per-entry value character budget
  conflictResolution: 'prefer_higher_confidence_then_priority',
  backgroundOrder: ['identity', 'soul', 'working', 'session'],
  expirationActions: {
    softDaysBeforeExpiry: 30,
    archiveLimit: 50
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
      expiredEntries: [],
      softExpiredEntries: [],
      conflicts: [],
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
      expiredEntries: Array.isArray(store.expiredEntries) ? store.expiredEntries : [],
      softExpiredEntries: Array.isArray(store.softExpiredEntries) ? store.softExpiredEntries : [],
      conflicts: Array.isArray(store.conflicts) ? store.conflicts : [],
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
    // 同键且值互相包含 → 细化/合并，非冲突
    if (existingValue === candidateValue ||
        existingValue.includes(candidateValue) ||
        candidateValue.includes(existingValue)) {
      return false;
    }
    // 仅当显式同键且互不包含时才视为真冲突；不同 key（含自动生成）的同类条目
    // 属于细化更新，交由 confidence/priority 合并而非阻塞确认。
    return existing.key === candidate.key && !existingValue.includes(candidateValue) &&
      !candidateValue.includes(existingValue);
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
    const confidence = Math.max(existing.confidence || 0, incoming.confidence || 0);
    return {
      ...existing,
      ...incoming,
      domain: mergedDomain,
      value: this.mergeValues(existing.value, incoming.value),
      confidence,
      priority: Math.max(existing.priority || 0, this.getDomainPriority(mergedDomain)),
      updatedAt: new Date().toISOString()
    };
  }

  applyExpiration(store) {
    const now = Date.now();
    const retained = [];
    const expiredEntries = [...store.expiredEntries];
    const softExpiredEntries = [...store.softExpiredEntries];
    const softWindowDays = store.policies.expirationActions?.softDaysBeforeExpiry ?? 30;

    for (const entry of store.entries) {
      const ttlDays = store.policies.expirationDays?.[entry.type];
      if (!ttlDays) {
        retained.push(entry);
        continue;
      }

      const ageMs = now - new Date(entry.updatedAt || entry.createdAt || now).getTime();
      const maxAgeMs = ttlDays * 24 * 60 * 60 * 1000;
      const softAgeMs = Math.max(0, maxAgeMs - softWindowDays * 24 * 60 * 60 * 1000);

      if (ageMs > maxAgeMs) {
        expiredEntries.push({ ...entry, expiredAt: new Date().toISOString() });
      } else {
        if (ageMs > softAgeMs) {
          softExpiredEntries.push({ ...entry, softExpiredAt: new Date().toISOString() });
        }
        retained.push(entry);
      }
    }

    store.entries = retained;
    store.expiredEntries = expiredEntries.slice(-50);
    store.softExpiredEntries = softExpiredEntries.slice(-50);
    return store;
  }

  upsertEntry(sessionId, input = {}) {
    const store = this.applyExpiration(this.loadStore(sessionId));
    const entries = [...store.entries];
    const key = input.key || this.generateKey(input.value);
    const existingIndex = entries.findIndex((entry) => entry.key === key);

    // Per-entry character budget: truncate oversized values to prevent unbounded growth.
    let value = String(input.value ?? '');
    const maxChars = this.policy.maxEntryChars ?? store.policies.maxEntryChars ?? DEFAULT_POLICY.maxEntryChars;
    if (value.length > maxChars) {
      value = `${value.slice(0, maxChars)}…[truncated]`;
    }

    const entry = {
      id: existingIndex >= 0 ? entries[existingIndex].id : this.generateId(),
      key,
      value,
      type: input.type || 'fact',
      domain: this.normalizeDomain(input.domain || 'session'),
      confidence: input.confidence ?? 1,
      source: input.source || 'explicit',
      priority: input.priority ?? this.getDomainPriority(input.domain || 'session'),
      createdAt: existingIndex >= 0 ? entries[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      entries[existingIndex] = this.mergeEntries(entries[existingIndex], entry);
    } else {
      entries.push(entry);
    }

    // Global store budget: evict lowest-priority/oldest entries beyond maxEntries.
    const maxEntries = this.policy.maxEntries ?? store.policies.maxEntries ?? DEFAULT_POLICY.maxEntries;
    if (entries.length > maxEntries) {
      entries.sort((a, b) => {
        const priorityDelta = (b.priority || 0) - (a.priority || 0);
        if (priorityDelta !== 0) return priorityDelta;
        return String(b.updatedAt).localeCompare(String(a.updatedAt));
      });
      // Keep the highest-priority slice; move evicted to expiredEntries for audit.
      const evicted = entries.splice(maxEntries);
      store.expiredEntries = [
        ...(store.expiredEntries || []),
        ...evicted.map((e) => ({ ...e, removedAt: new Date().toISOString(), reason: 'global_budget_eviction' }))
      ].slice(-50);
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

  forget(sessionId, keyOrId, options = {}) {
    const store = this.loadStore(sessionId);
    const entryCountBefore = store.entries.length;
    const removedEntries = [];

    store.entries = store.entries.filter((entry) => {
      const shouldRemove = entry.key === keyOrId || entry.id === keyOrId;
      if (shouldRemove) removedEntries.push({ ...entry, removedAt: new Date().toISOString(), reason: options.reason || 'explicit_forget' });
      return !shouldRemove;
    });

    for (const domain of ['identity', 'soul']) {
      store.profiles[domain] = store.profiles[domain].filter((entry) => {
        const shouldRemove = entry.key === keyOrId || entry.id === keyOrId;
        if (shouldRemove) removedEntries.push({ ...entry, removedAt: new Date().toISOString(), reason: options.reason || 'explicit_forget' });
        return !shouldRemove;
      });
    }

    const removed = entryCountBefore !== store.entries.length || removedEntries.length > 0;
    if (removed) {
      this.saveStore(sessionId, {
        ...store,
        expiredEntries: [...store.expiredEntries, ...removedEntries].slice(-50)
      });
    }
    return { removed, removedEntries };
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
      priority: input.priority ?? this.getDomainPriority(domain),
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

    if (this.isConflict(similar, candidate)) {
      const conflict = {
        id: this.generateId(),
        existing: similar,
        candidate,
        createdAt: new Date().toISOString(),
        resolution: this.policy.conflictResolution,
        status: 'needs_confirmation'
      };
      store.conflicts = [...store.conflicts, conflict].slice(-50);
      this.saveStore(sessionId, store);
      return { action: 'conflict', conflict };
    }

    return this.update(sessionId, similar.key, {
      value: this.mergeValues(similar.value, candidate.value),
      confidence: Math.max(similar.confidence || 0, candidate.confidence || 0),
      type: candidate.type || similar.type,
      source: candidate.source || similar.source,
      priority: Math.max(similar.priority || 0, this.getDomainPriority(candidate.domain || similar.domain))
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
      const current = this.updateIdentity(sessionId, { ...candidate, domain });
      return { action: 'identity', entry: current, candidate };
    }
    if (domain === 'soul') {
      const current = this.updateSoul(sessionId, { ...candidate, domain });
      return { action: 'soul', entry: current, candidate };
    }

    const store = this.loadStore(sessionId);
    const similar = this.findSimilar(store.entries || [], candidate);
    if (!similar) {
      const entry = this.remember(sessionId, { ...candidate, source: candidate.source || 'extracted', domain });
      return { action: 'save', entry, candidate };
    }

    if (this.isConflict(similar, candidate)) {
      const conflict = {
        id: this.generateId(),
        existing: similar,
        candidate,
        createdAt: new Date().toISOString(),
        resolution: this.policy.conflictResolution,
        status: 'needs_confirmation'
      };
      store.conflicts = [...store.conflicts, conflict].slice(-50);
      this.saveStore(sessionId, store);
      return { action: 'conflict', conflict, candidate, nextAction: 'confirm_with_user' };
    }

    // 细化更新：更高置信度的候选值合并旧值，避免信息丢失
    const entry = this.update(sessionId, similar.key, {
      value: this.mergeValues(similar.value, String(candidate.value)),
      confidence: Math.max(similar.confidence || 0, candidate.confidence || 0),
      type: candidate.type || similar.type,
      source: candidate.source || similar.source,
      priority: Math.max(similar.priority || 0, this.getDomainPriority(candidate.domain || similar.domain))
    });
    return { action: 'update', entry, candidate };
  }

  search(sessionId, query = '', options = {}) {
    const limit = options.limit ?? this.maxRetrieve;
    const domain = options.domain ? this.normalizeDomain(options.domain) : null;
    const store = this.loadStore(sessionId);
    const entries = domain ? store.entries.filter((entry) => entry.domain === domain) : store.entries;

    if (!query.trim()) {
      return entries
        .slice()
        .sort((a, b) => {
          const priorityDelta = (b.priority || 0) - (a.priority || 0);
          if (priorityDelta !== 0) return priorityDelta;
          return String(b.updatedAt).localeCompare(String(a.updatedAt));
        })
        .slice(0, limit);
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    // 先按词项命中打分：只有真正命中的条目才进入候选，避免 priority/confidence
    // 基础分让无关记忆混入检索结果。
    const scored = entries
      .map((entry) => {
        const text = `${entry.key} ${entry.value} ${entry.type} ${entry.domain}`.toLowerCase();
        let termHits = 0;
        for (const term of terms) {
          if (text.includes(term)) {
            termHits += 1;
          }
        }
        return { entry, termHits };
      })
      .filter((item) => item.termHits > 0)
      .map(({ entry, termHits }) => ({
        entry,
        score: termHits + (entry.priority || 0) * 0.1 + Math.min((entry.confidence || 0) / 10, 0.2)
      }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return String(b.entry.updatedAt).localeCompare(String(a.entry.updatedAt));
      });

    // 无任何词项命中时，才回退到最近条目（避免空结果）
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
      mergedDuplicates.push({
        kept: merged.key,
        mergedFrom: entry.id || entry.key,
        resolution: store.policies.conflictResolution
      });
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
    const limits = store.policies.backgroundLimit || DEFAULT_POLICY.backgroundLimit;
    const ordered = this.policy.backgroundOrder || DEFAULT_POLICY.backgroundOrder;
    const result = {};

    for (const domain of ordered) {
      if (domain === 'identity') {
        result.identity = store.profiles.identity.slice(-limits.identity);
        continue;
      }
      if (domain === 'soul') {
        result.soul = store.profiles.soul.slice(-limits.soul);
        continue;
      }
      result[domain] = store.entries
        .filter((entry) => entry.domain === domain)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, limits[domain] || 3);
    }

    return {
      ...result,
      recentActivity: this.summarizeActivity(store.recentActivity)
    };
  }
}

export const memoryManager = new MemoryManager();
export default memoryManager;
