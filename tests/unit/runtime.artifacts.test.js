import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Artifact } from '../../src/runtime/artifacts/Artifact.js';
import { ArtifactManager } from '../../src/runtime/artifacts/ArtifactManager.js';
import { DependencyGraph } from '../../src/runtime/artifacts/DependencyGraph.js';
import { IncrementalReview } from '../../src/runtime/artifacts/IncrementalReview.js';
import { KnowledgeProvider } from '../../src/runtime/artifacts/KnowledgeProvider.js';
import { MemoryKnowledgeProvider } from '../../src/runtime/artifacts/MemoryKnowledgeProvider.js';

test('Artifact supports versioning with update/history', () => {
  const artifact = new Artifact({ name: 'analysis.md', content: 'v1' });
  assert.equal(artifact.getVersion(), 1);

  // first update → v2, previous pushed to history
  const { version } = artifact.update('v2');
  assert.equal(version, 2);
  assert.equal(artifact.content, 'v2');

  const history = artifact.getHistory();
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((h) => h.version),
    [1, 2]
  );
});

test('Artifact compare detects content changes between versions', () => {
  const artifact = new Artifact({ name: 'a.md', content: 'v1' });
  artifact.update('v2');
  artifact.update('v3');

  // v1 vs current (v3)
  assert.equal(artifact.compare(1).changed, true);
  // v1 vs v1
  assert.equal(artifact.compare(1, 1).changed, false);
});

test('Artifact rollback restores a previous version', () => {
  const artifact = new Artifact({ name: 'a.md', content: 'v1' });
  artifact.update('v2');
  artifact.update('v3');

  const { version } = artifact.rollback(1);
  assert.equal(artifact.content, 'v1');
  // rollback creates a new version (now v4)
  assert.equal(version, 4);

  // invalid version throws
  assert.throws(() => artifact.rollback(99));
});

test('Artifact serializes and rehydrates via toJSON/fromJSON', () => {
  const original = new Artifact({ name: 'a.md', content: 'v1', tags: ['review'] });
  original.update('v2');

  const restored = Artifact.fromJSON(original.toJSON());
  assert.equal(restored.name, 'a.md');
  assert.deepEqual(restored.tags, ['review']);
  assert.equal(restored.getVersion(), 2);
});

test('ArtifactManager creates/updates/reads/deletes with persistence', () => {
  const baseDir = path.join(os.tmpdir(), `artmgr_${Date.now()}`);
  const manager = new ArtifactManager({ baseDir });

  try {
    // create
    const artifact = manager.create({
      name: 'planning.md',
      type: 'markdown',
      content: 'v1'
    });
    assert.ok(artifact.id);

    // update → version bump persisted
    const { version } = manager.update(artifact.id, 'v2');
    assert.equal(version, 2);

    // read from a fresh manager (no cache) proves persistence
    const reloaded = new ArtifactManager({ baseDir }).read(artifact.id);
    assert.ok(reloaded);
    assert.equal(reloaded.content, 'v2');

    // compare + history via manager
    assert.equal(manager.compare(artifact.id, 1).changed, true);
    assert.equal(manager.getHistory(artifact.id).length, 2);

    // list returns the artifact
    const listed = manager.list();
    assert.equal(listed.length, 1);

    // delete removes it
    assert.equal(manager.delete(artifact.id), true);
    assert.equal(new ArtifactManager({ baseDir }).read(artifact.id), null);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('DependencyGraph tracks dependents and computes affected set', () => {
  const graph = new DependencyGraph();
  // review.md depends on analysis.md; analysis.md depends on source.cpp
  graph.addDependency('review.md', 'analysis.md');
  graph.addDependency('analysis.md', 'source.cpp');

  assert.deepEqual(graph.getDependents('analysis.md'), ['review.md']);
  // analysis.md depends on source.cpp (edge from → to)
  assert.deepEqual(graph.getDependencies('analysis.md'), ['source.cpp']);

  // changing source.cpp affects analysis.md AND review.md (transitive)
  const affected = graph.getAffected('source.cpp');
  assert.ok(affected.includes('analysis.md'));
  assert.ok(affected.includes('review.md'));

  // required deps of review.md include analysis.md + source.cpp
  const required = graph.getRequired('review.md');
  assert.ok(required.includes('analysis.md'));
  assert.ok(required.includes('source.cpp'));

  // serialization round-trip
  const restored = DependencyGraph.fromJSON(graph.toJSON());
  assert.deepEqual(restored.getDependents('analysis.md'), ['review.md']);
});

test('IncrementalReview computes direct + affected scope from modified files', () => {
  const graph = new DependencyGraph();
  graph.addDependency('review.md', 'analysis.md');
  graph.addDependency('analysis.md', 'source.cpp');

  const review = new IncrementalReview({ graph });
  review.registerSource('analysis.md', ['src/analysis.js']);
  review.registerSource('review.md', ['docs/review.md']);

  // modifying src/analysis.js directly touches analysis.md, affects review.md
  const result = review.review({ modifiedFiles: ['src/analysis.js'] });

  assert.ok(result.scope.direct.includes('analysis.md'));
  assert.ok(result.scope.affected.includes('review.md'));
  assert.equal(result.impactAnalysis.totalAffected >= 2, true);
});

test('KnowledgeProvider is an abstract interface (throws on unimplemented)', () => {
  const provider = new KnowledgeProvider();
  assert.throws(() => provider.indexTags({ id: 'x' }));
  assert.throws(() => provider.queryByTag('tag'));
});

test('MemoryKnowledgeProvider implements tag/dependency/reference index', () => {
  const provider = new MemoryKnowledgeProvider();

  provider.indexTags({ id: 'analysis.md', type: 'markdown', tags: ['review'] });
  provider.indexDependency('review.md', 'analysis.md');
  provider.indexReference({
    artifactId: 'analysis.md',
    target: 'src/analysis.js',
    kind: 'source'
  });

  assert.deepEqual(provider.queryByTag('review'), ['analysis.md']);
  assert.deepEqual(provider.getDependencies('review.md'), ['analysis.md']);
  assert.equal(provider.getReferences('analysis.md').length, 1);
  assert.equal(provider.getEntry('analysis.md').type, 'markdown');
});
