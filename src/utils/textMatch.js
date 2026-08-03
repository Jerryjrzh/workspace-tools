/**
 * Text matching utilities for file_patch and edit operations.
 * Handles transport escaping, whitespace normalization, and fuzzy block matching.
 */

export function transportEscapeCandidates(value) {
  const text = String(value);
  const candidates = [];
  const add = (candidate) => {
    if (candidate !== text && !candidates.includes(candidate)) candidates.push(candidate);
  };

  add(text.replace(/\\+(?=["'])/g, ''));
  add(text
    .replace(/\\+r\\+n/g, '\n')
    .replace(/\\+n/g, '\n')
    .replace(/\\+r/g, '\r')
    .replace(/\\+t/g, '\t')
    .replace(/\\+(?=["'])/g, ''));
  return candidates;
}

export function normalizeLineForMatch(line) {
  return String(line)
    .replace(/\r/g, '')
    .replace(/[\t ]+$/g, '')
    .replace(/^[\t ]+/g, (leading) => leading.replace(/\t/g, '  '))
    .replace(/'/g, '"');
}

export function normalizeBlockForMatch(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(normalizeLineForMatch)
    .join('\n');
}

function lineSimilarity(a, b) {
  const na = normalizeLineForMatch(a);
  const nb = normalizeLineForMatch(b);
  if (na === nb) return 1;
  if (!na || !nb) return na === nb ? 1 : 0;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter) && shorter.length >= 8) {
    return shorter.length / longer.length;
  }

  const tokensA = new Set(na.match(/[A-Za-z_]\w{2,}/g) || []);
  const tokensB = new Set(nb.match(/[A-Za-z_]\w{2,}/g) || []);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

export function countMatches(content, target) {
  return target.length === 0 ? 0 : content.split(target).length - 1;
}

export function countNormalizedMatches(content, target) {
  const normalizedContent = normalizeBlockForMatch(content);
  const normalizedTarget = normalizeBlockForMatch(target);
  return countMatches(normalizedContent, normalizedTarget);
}

/**
 * Find the best contiguous line block matching oldStr within content.
 * Returns null when no block meets minScore or when multiple blocks tie.
 */
export function findFuzzyBlock(content, oldStr, options = {}) {
  const minScore = options.minScore ?? 0.82;
  const minGap = options.minGap ?? 0.08;
  const fileLines = content.split('\n');
  const oldLines = oldStr.split('\n');
  const blockSize = oldLines.length;
  if (blockSize === 0 || fileLines.length < blockSize) return null;

  const candidates = [];
  for (let start = 0; start <= fileLines.length - blockSize; start++) {
    let score = 0;
    for (let offset = 0; offset < blockSize; offset++) {
      score += lineSimilarity(fileLines[start + offset], oldLines[offset]);
    }
    score /= blockSize;
    if (score >= minScore) {
      candidates.push({
        score,
        startLine: start + 1,
        endLine: start + blockSize,
        matchedText: fileLines.slice(start, start + blockSize).join('\n')
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const second = candidates[1];
  if (second && best.score - second.score < minGap) {
    return {
      ambiguous: true,
      score: best.score,
      candidates: candidates.slice(0, 5).map(({ startLine, endLine, score }) => ({ startLine, endLine, score }))
    };
  }
  return best;
}

export function matchingTransportCandidate(content, target) {
  for (const candidate of transportEscapeCandidates(target)) {
    const matchCount = countMatches(content, candidate);
    if (matchCount > 0) return { candidate, matchCount };
  }
  for (const candidate of transportEscapeCandidates(target)) {
    const matchCount = countNormalizedMatches(content, candidate);
    if (matchCount > 0) {
      return { candidate, matchCount, normalized: true };
    }
  }
  return null;
}

export function nearestMatch(existing, target, window = 3) {
  const lines = existing.split('\n');
  const targetLines = String(target).trim().split('\n').map((line) => line.trim()).filter(Boolean);
  const significantLines = targetLines.filter((line) => line.length >= 12);
  const tokens = [...new Set(significantLines.join(' ').match(/[A-Za-z_]\w{3,}/g) || [])];
  let best = { score: 0, index: -1 };
  lines.forEach((line, index) => {
    const block = lines.slice(index, index + Math.max(targetLines.length, 1)).join('\n');
    const lineHits = significantLines.reduce((total, needle) => total + (block.includes(needle) ? 8 : 0), 0);
    const tokenHits = tokens.reduce((total, token) => total + (block.includes(token) ? 1 : 0), 0);
    const score = lineHits + tokenHits;
    if (score > best.score) best = { score, index };
  });
  if (best.index < 0 || best.score === 0) return null;
  const start = Math.max(0, best.index - window);
  const end = Math.min(lines.length, best.index + Math.max(targetLines.length, 1) + window);
  return { line: best.index + 1, startLine: start + 1, endLine: end, content: lines.slice(start, end).join('\n') };
}
