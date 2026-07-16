import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MemoryProvider } from '../../src/runtime/providers/MemoryProvider.js';
import { MemoryManager } from '../../src/managers/memory.js';

function createTempManager() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-manager-'));
  const provider = new MemoryProvider(path.join(tempHome, '.lmstudio', 'memory'));
  const manager = new MemoryManager(provider, { confidenceThreshold: 0.7, maxRetrieve: 4 });
  return { tempHome, manager };
}

test('memory manager remembers, updates, merges, and forgets entries', () => {
  const { tempHome, manager } = createTempManager();

  try {
    const first = manager.remember('session-a', {
      key: 'language',
      value: 'Python',
      type: 'preference'
    });
    assert.equal(first.key, 'language');

    const updated = manager.update('session-a', 'language', { value: 'TypeScript' });
    assert.equal(updated.value, 'TypeScript');

    const merged = manager.merge('session-a', {
      key: 'language',
      value: 'TypeScript for backend',
      type: 'preference',
      confidence: 0.9
    });
    assert.match(merged.value, /TypeScript/);

    const forgotten = manager.forget('session-a', 'language');
    assert.equal(forgotten.removed, true);
    assert.equal(manager.load('session-a').entries.length, 0);
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('memory manager processes candidates with confidence and conflict handling', () => {
  const { tempHome, manager } = createTempManager();

  try {
    const ignored = manager.processCandidate('session-b', {
      value: 'maybe likes Go',
      confidence: 0.2
    });
    assert.equal(ignored.action, 'ignore');

    const saved = manager.processCandidate('session-b', {
      value: 'Default language is TypeScript',
      type: 'preference',
      confidence: 0.92
    });
    assert.equal(saved.action, 'save');

    const updated = manager.processCandidate('session-b', {
      value: 'Default language is Rust',
      type: 'preference',
      confidence: 0.95
    });
    assert.equal(updated.action, 'update');
    assert.equal(updated.entry.value, 'Default language is Rust');
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('memory manager retrieves only relevant memories for a query', () => {
  const { tempHome, manager } = createTempManager();

  try {
    manager.remember('session-c', { key: 'os', value: 'OpenWrt router setup', type: 'fact' });
    manager.remember('session-c', { key: 'lang', value: 'Prefers TypeScript', type: 'preference' });
    manager.remember('session-c', { key: 'db', value: 'Uses SQLite for local storage', type: 'fact' });

    const results = manager.search('session-c', 'OpenWrt Linux', { limit: 2 });
    assert.equal(results.length, 1);
    assert.match(results[0].value, /OpenWrt/);
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
