// src/runtime/artifacts/index.js
export { Artifact } from './Artifact.js';
export { ArtifactManager } from './ArtifactManager.js';
export { DependencyGraph } from './DependencyGraph.js';
export { IncrementalReview } from './IncrementalReview.js';
export { KnowledgeProvider } from './KnowledgeProvider.js';
export { MemoryKnowledgeProvider } from './MemoryKnowledgeProvider.js';

import { Artifact } from './Artifact.js';
import { ArtifactManager } from './ArtifactManager.js';
import { DependencyGraph } from './DependencyGraph.js';
import { IncrementalReview } from './IncrementalReview.js';
import { KnowledgeProvider } from './KnowledgeProvider.js';
import { MemoryKnowledgeProvider } from './MemoryKnowledgeProvider.js';

/** Convenience factory: a wired artifact workspace (manager + graph + review). */
export function createArtifactWorkspace(options = {}) {
  const manager = new ArtifactManager({ baseDir: options.baseDir });
  return {
    artifacts: manager,
    graph: new DependencyGraph(),
    incrementalReview: new IncrementalReview()
  };
}

export default {
  Artifact,
  ArtifactManager,
  DependencyGraph,
  IncrementalReview,
  KnowledgeProvider,
  MemoryKnowledgeProvider
};
