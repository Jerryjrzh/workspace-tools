// src/runtime/artifacts/MemoryKnowledgeProvider.js
import { KnowledgeProvider } from './KnowledgeProvider.js';

/**
 * MemoryKnowledgeProvider - concrete in-memory implementation of the abstract
 * KnowledgeProvider contract (tag / dependency / reference index).
 *
 * Embedding is intentionally NOT implemented here — deferred to Phase 6 where a
 * model-agnostic provider can be plugged without rework.
 */
export class MemoryKnowledgeProvider extends KnowledgeProvider {
  constructor() {
    super();
    this._tags = new Map(); // tag → Set of artifact ids
    this._deps = new Map(); // id → Set of dependency ids
    this._refs = new Map(); // id → array of reference entries
    this._entries = new Map(); // id → entry metadata { type, tags }
  }

  indexTags(entry) {
    const { id, type, tags } = entry;
    if (!id) throw new Error('indexTags requires an artifact id');
    this._entries.set(id, { type: type || 'markdown', tags: [...(tags || [])] });
    for (const tag of tags || []) {
      const set = this._tags.get(tag) || new Set();
      set.add(id);
      this._tags.set(tag, set);
    }
  }

  indexDependency(fromId, toId) {
    if (!this._deps.has(fromId)) this._deps.set(fromId, new Set());
    this._deps.get(fromId).add(toId);
  }

  indexReference(ref) {
    const { artifactId } = ref;
    if (!artifactId) throw new Error('indexReference requires an artifactId');
    const list = this._refs.get(artifactId) || [];
    list.push({ ...ref });
    this._refs.set(artifactId, list);
  }

  queryByTag(tag) {
    return [...(this._tags.get(tag) || [])];
  }

  getDependencies(artifactId) {
    return [...(this._deps.get(artifactId) || [])];
  }

  getReferences(artifactId) {
    return this._refs.get(artifactId) || [];
  }

  /** Get entry metadata for an artifact id. */
  getEntry(id) {
    return this._entries.get(id) || null;
  }
}

export default MemoryKnowledgeProvider;
