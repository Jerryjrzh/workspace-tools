// src/runtime/artifacts/IncrementalReview.js

/**
 * IncrementalReview - Modified Files → Affected Artifacts → diff review +
 * impact analysis.
 *
 * Given a set of modified files, it maps them to affected artifacts via the
 * dependency graph and produces a focused review scope (only what changed).
 */
export class IncrementalReview {
  constructor(options = {}) {
    this.graph = options.graph || null;
    // artifactId → source file path(s) that produced it
    this._artifactSources = new Map();
  }

  /** Register which source files an artifact depends on. */
  registerSource(artifactId, sourceFiles) {
    const list = Array.isArray(sourceFiles) ? sourceFiles : [sourceFiles];
    this._artifactSources.set(artifactId, [...list]);
  }

  /**
   * Compute the review scope for a set of modified files.
   * @param {string|Array<string>} modifiedFiles
   * @returns {{direct: string[], affected: string[]}}
   */
  computeScope(modifiedFiles) {
    const files = Array.isArray(modifiedFiles) ? modifiedFiles : [modifiedFiles];

    // Directly touched artifacts (their source file changed)
    const direct = [];
    for (const [artifactId, sources] of this._artifactSources) {
      if (sources.some((src) => files.includes(src))) {
        direct.push(artifactId);
      }
    }

    // Affected artifacts: transitive dependents of the directly touched ones
    let affected = [...direct];
    if (this.graph && direct.length > 0) {
      const impacted = this.graph.getAffected(direct);
      affected = [...new Set([...affected, ...impacted])];
    }

    return { direct, affected };
  }

  /**
   * Produce a diff review summary for the scope.
   * @param {Object} opts - { modifiedFiles, diffs? }
   */
  review(opts) {
    const { direct, affected } = this.computeScope(
      opts.modifiedFiles || []
    );
    return {
      scope: { direct, affected },
      impactAnalysis: {
        directlyTouched: direct.length,
        totalAffected: affected.length
      },
      reviewedAt: Date.now()
    };
  }

  /** Serialize to plain JSON. */
  toJSON() {
    const sourceMap = {};
    for (const [id, sources] of this._artifactSources) {
      sourceMap[id] = [...sources];
    }
    return { artifactSources: sourceMap };
  }

  static fromJSON(data) {
    const review = new IncrementalReview();
    for (const [id, sources] of Object.entries(data.artifactSources || {})) {
      review.registerSource(id, sources);
    }
    return review;
  }
}

export default IncrementalReview;
