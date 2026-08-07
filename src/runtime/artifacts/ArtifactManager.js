// src/runtime/artifacts/ArtifactManager.js
import fs from 'fs';
import path from 'path';
import { Artifact } from './Artifact.js';

/**
 * ArtifactManager - create / read / update / delete artifacts with metadata
 * (type/tags/source) and version history. Persists to `.lmstudio-artifacts/*.json`.
 */
export class ArtifactManager {
  constructor(options = {}) {
    this.baseDir =
      options.baseDir || path.join(process.cwd(), '.lmstudio-artifacts');
    // in-memory cache keyed by artifact id
    this._cache = new Map();
  }

  /** Resolve the file path for an artifact id. */
  _filePath(id) {
    return path.join(this.baseDir, `${id}.json`);
  }

  /**
   * Create a new artifact and persist it.
   * @returns {Artifact}
   */
  create(init = {}) {
    const artifact = init instanceof Artifact ? init : new Artifact(init);
    this._persist(artifact);
    return artifact;
  }

  /** Load an artifact by id (from cache or disk). Returns null if absent. */
  read(id) {
    if (this._cache.has(id)) {
      return this._cache.get(id);
    }
    const file = this._filePath(id);
    if (!fs.existsSync(file)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const artifact = Artifact.fromJSON(data);
      this._cache.set(id, artifact);
      return artifact;
    } catch {
      return null;
    }
  }

  /**
   * Update an artifact's content (creates a new version) and persist.
   * @param {string} id
   * @param {string} newContent
   * @returns {{version: number}}
   */
  update(id, newContent) {
    const artifact = this._requireArtifact(id);
    const result = artifact.update(newContent);
    this._persist(artifact);
    return result;
  }

  /** Delete an artifact from disk + cache. Returns true if removed. */
  delete(id) {
    this._cache.delete(id);
    const file = this._filePath(id);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }

  /**
   * Compare two versions of an artifact.
   * @param {string} id
   * @param {number} a - version index (1-based)
   * @param {number} b - version index (1-based, defaults to current)
   */
  compare(id, a, b) {
    return this._requireArtifact(id).compare(a, b);
  }

  /**
   * Rollback an artifact to a previous version and persist.
   * @returns {{version: number}}
   */
  rollback(id, version) {
    const artifact = this._requireArtifact(id);
    const result = artifact.rollback(version);
    this._persist(artifact);
    return result;
  }

  /** Get the full version history for an artifact. */
  getHistory(id) {
    return this._requireArtifact(id).getHistory();
  }

  /**
   * List all persisted artifacts.
   * @param {string} [type] - optional type filter
   */
  list(type = null) {
    if (!fs.existsSync(this.baseDir)) return [];
    const files = fs.readdirSync(this.baseDir)
      .filter((f) => f.endsWith('.json'));
    const artifacts = [];
    for (const name of files) {
      const id = name.replace('.json', '');
      const artifact = this.read(id);
      if (!artifact) continue;
      if (type && artifact.type !== type) continue;
      artifacts.push(artifact.toJSON());
    }
    return artifacts;
  }

  /** Internal: persist an artifact to disk + cache. */
  _persist(artifact) {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const file = this._filePath(artifact.id);
    fs.writeFileSync(file, JSON.stringify(artifact.toJSON(), null, 2), 'utf8');
    this._cache.set(artifact.id, artifact);
    return artifact;
  }

  /** Internal: load an artifact or throw. */
  _requireArtifact(id) {
    const artifact = this.read(id);
    if (!artifact) throw new Error(`Artifact not found: ${id}`);
    return artifact;
  }
}

export default ArtifactManager;
