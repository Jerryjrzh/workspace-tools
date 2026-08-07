// src/runtime/artifacts/Artifact.js

/**
 * Artifact - unified representation of Markdown / JSON / PDF / Image / Code /
 * Diagram outputs. Supports versioning (v1/v2/v3) with Compare / Rollback /
 * History.
 */
export class Artifact {
  constructor(init = {}) {
    const now = Date.now();
    this.id =
      init.id || `art_${now}_${Math.random().toString(36).slice(2, 8)}`;
    this.name = init.name || 'unnamed';
    this.type = init.type || 'markdown'; // markdown | json | pdf | image | code | diagram
    this.content = init.content ?? '';
    this.tags = Array.isArray(init.tags) ? [...init.tags] : [];
    this.source = init.source || null; // origin (file path / tool name)
    this.createdAt = init.createdAt || now;
    this.updatedAt = init.updatedAt || now;

    // Version history: array of { version, content, timestamp }
    this.history = Array.isArray(init.history) ? [...init.history] : [];
  }

  /** Current version number (1-based). */
  getVersion() {
    return this.history.length + 1;
  }

  /**
   * Update the artifact content, pushing the previous state into history.
   * @param {string} newContent
   * @returns {{version: number}} the new version index
   */
  update(newContent) {
    // snapshot current content as a historical version before overwriting
    this.history.push({
      version: this.getVersion(),
      content: this.content,
      timestamp: Date.now()
    });
    this.content = newContent;
    this.updatedAt = Date.now();
    return { version: this.getVersion() };
  }

  /**
   * Compare two versions of the artifact.
   * @param {number} a - version index (1-based)
   * @param {number} b - version index (1-based)
   * @returns {{a, b, changed}} whether content differs
   */
  compare(a, b) {
    // If only one version given, compare it against the current content.
    const targetA = a ?? this.getVersion();
    const targetB = b ?? this.getVersion();
    const va = this._contentAt(targetA);
    const vb = this._contentAt(targetB);
    return {
      a: targetA,
      b: targetB,
      changed: va !== vb
    };
  }

  /**
   * Rollback to a previous version.
   * @param {number} version - target version (1-based)
   * @returns {{version}} the restored version index
   */
  rollback(version) {
    const content = this._contentAt(version);
    if (content === null) {
      throw new Error(`Artifact has no version ${version}`);
    }
    // push current as history, then restore target
    this.history.push({
      version: this.getVersion(),
      content: this.content,
      timestamp: Date.now()
    });
    this.content = content;
    this.updatedAt = Date.now();
    return { version: this.getVersion() };
  }

  /** Get the full version history (oldest → newest). */
  getHistory() {
    const versions = [
      ...this.history.map((h) => ({
        version: h.version,
        content: h.content,
        timestamp: h.timestamp
      })),
      { version: this.getVersion(), content: this.content, timestamp: this.updatedAt }
    ];
    return versions;
  }

  /** Resolve the content at a given version index (1-based). */
  _contentAt(version) {
    if (version === this.getVersion()) return this.content;
    const entry = this.history.find((h) => h.version === version);
    return entry ? entry.content : null;
  }

  /** Serialize to plain JSON. */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      content: this.content,
      tags: [...this.tags],
      source: this.source,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      history: this.history.map((h) => ({ ...h }))
    };
  }

  static fromJSON(data) {
    return new Artifact(data);
  }
}

export default Artifact;
