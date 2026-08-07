// src/runtime/artifacts/KnowledgeProvider.js

/**
 * KnowledgeProvider - abstract interface for knowledge indexing.
 *
 * Per review: Embedding models change often, so the Framework should NOT bind
 * to one. This defines only the abstract contract (tag / dependency /
 * reference). Embedding is deferred to Phase 6 where a model-agnostic provider
 * can be plugged in without rework.
 */
export class KnowledgeProvider {
  /**
   * Index an artifact's tags for retrieval.
   * @param {Object} entry - { id, type, tags }
   * @returns {Promise|void}
   */
  indexTags(entry) {
    throw new Error('KnowledgeProvider.indexTags must be implemented');
  }

  /**
   * Record a dependency relationship between artifacts.
   * @param {string} fromId
   * @param {string} toId
   */
  indexDependency(fromId, toId) {
    throw new Error('KnowledgeProvider.indexDependency must be implemented');
  }

  /**
   * Index a reference (artifact → source file / external doc).
   * @param {Object} ref - { artifactId, target, kind }
   */
  indexReference(ref) {
    throw new Error('KnowledgeProvider.indexReference must be implemented');
  }

  /** Query artifacts by tag. Returns array of matching ids/entries. */
  queryByTag(tag) {
    throw new Error('KnowledgeProvider.queryByTag must be implemented');
  }

  /** Resolve dependencies for an artifact id. */
  getDependencies(artifactId) {
    throw new Error('KnowledgeProvider.getDependencies must be implemented');
  }

  /** Resolve references for an artifact id. */
  getReferences(artifactId) {
    throw new Error('KnowledgeProvider.getReferences must be implemented');
  }
}

export default KnowledgeProvider;
