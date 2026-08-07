// src/runtime/agents/Consensus.js

/**
 * Consensus - aggregates multiple agent verdicts into a consensus decision.
 *
 * Supports majority voting and weighted agreement. Each input is an entry like
 * { role, ok, output } (from Coordinator.dispatch) or { vote: 'pass'|'fail' }.
 */
export class Consensus {
  constructor(options = {}) {
    // weights per role for weighted consensus
    this.weights = options.weights || {};
  }

  /**
   * Compute a consensus from agent results.
   * @param {Array<Object>} entries - [{ role, ok?, output?: {verdict?}, vote? }]
   * @returns {{decision: string, agreeCount, total, confidence}}
   */
  decide(entries) {
    if (!entries || entries.length === 0) {
      return { decision: 'undecided', agreeCount: 0, total: 0, confidence: 0 };
    }

    let passWeight = 0;
    let failWeight = 0;

    for (const entry of entries) {
      const vote =
        typeof entry.vote === 'string'
          ? entry.vote
          : entry.ok !== false && entry.output?.verdict !== 'fail'
            ? 'pass'
            : 'fail';

      // role weight defaults to 1
      const w = this.weights[entry.role] ?? 1;
      if (vote === 'pass') passWeight += w;
      else failWeight += w;
    }

    const total = entries.length;
    const decision =
      passWeight > failWeight ? 'pass' : failWeight > passWeight ? 'fail' : 'tie';
    // confidence: fraction of weighted agreement toward the majority
    const agreeCount = Math.max(passWeight, failWeight);
    const maxPossible = total * Math.max(...Object.values(this.weights).concat([1]));
    const confidence =
      decision === 'tie'
        ? 0.5
        : Math.min(1, agreeCount / (maxPossible || 1));

    return { decision, agreeCount, total, confidence };
  }
}

export default Consensus;
