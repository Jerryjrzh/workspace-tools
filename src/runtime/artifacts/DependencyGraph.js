// src/runtime/artifacts/DependencyGraph.js

/**
 * DependencyGraph - tracks artifact dependencies (review.md → analysis.md →
 * source.cpp) so the runtime can trace affected artifacts for incremental
 * review / impact analysis.
 */
export class DependencyGraph {
  constructor() {
    // nodeId → Set of dependent node ids (edges: from → to)
    this._adjacency = new Map();
    // reverse edges: nodeId → Set of nodes it depends on
    this._reverse = new Map();
  }

  /**
   * Add a dependency edge: `from` depends on `to`.
   * @param {string} from - dependent artifact id
   * @param {string} to - dependency artifact id
   */
  addDependency(from, to) {
    if (!this._adjacency.has(to)) this._adjacency.set(to, new Set());
    this._adjacency.get(to).add(from);

    if (!this._reverse.has(from)) this._reverse.set(from, new Set());
    this._reverse.get(from).add(to);
  }

  /**
   * Remove a dependency edge.
   */
  removeDependency(from, to) {
    this._adjacency.get(to)?.delete(from);
    this._reverse.get(from)?.delete(to);
  }

  /** Get all direct dependents of `node` (things that depend on it). */
  getDependents(nodeId) {
    return [...(this._adjacency.get(nodeId) || [])];
  }

  /** Get all direct dependencies of `node` (things it depends on). */
  getDependencies(nodeId) {
    return [...(this._reverse.get(nodeId) || [])];
  }

  /**
   * Compute the transitive set of affected nodes when `rootIds` change.
   * Returns dependents recursively (impact analysis).
   * @param {string|Array<string>} rootIds
   */
  getAffected(rootIds) {
    const roots = Array.isArray(rootIds) ? rootIds : [rootIds];
    const visited = new Set();
    const queue = [...roots];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      for (const dependent of this.getDependents(current)) {
        if (!visited.has(dependent)) queue.push(dependent);
      }
    }

    return [...visited];
  }

  /**
   * Compute the transitive set of dependencies needed to analyze `rootIds`.
   * Returns dependencies recursively.
   */
  getRequired(rootIds) {
    const roots = Array.isArray(rootIds) ? rootIds : [rootIds];
    const visited = new Set();
    const queue = [...roots];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      for (const dep of this.getDependencies(current)) {
        if (!visited.has(dep)) queue.push(dep);
      }
    }

    return [...visited];
  }

  /** All nodes present in the graph. */
  getNodes() {
    const nodes = new Set();
    for (const key of this._adjacency.keys()) nodes.add(key);
    for (const key of this._reverse.keys()) nodes.add(key);
    return [...nodes];
  }

  /** Serialize to plain JSON. */
  toJSON() {
    const edges = [];
    for (const [to, dependents] of this._adjacency) {
      for (const from of dependents) {
        edges.push({ from, to });
      }
    }
    return { edges };
  }

  /** Rehydrate a graph from serialized JSON. */
  static fromJSON(data) {
    const graph = new DependencyGraph();
    for (const edge of data.edges || []) {
      graph.addDependency(edge.from, edge.to);
    }
    return graph;
  }
}

export default DependencyGraph;
