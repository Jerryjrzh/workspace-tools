// src/tools/file_read.js - Slimmed tool following new contract
// Only does business logic, trusts ctx.workspace

import fs from 'fs';
import path from 'path';

/**
 * file_read tool - Slim version
 * 
 * Contract:
 * - Input: (ctx, args) where ctx.workspace is Single Source of Truth
 * - Output: File content string or buffer object
 * - No backup, no path resolution - all done in Stage
 */
export async function file_read(ctx, args) {
  // Trust ctx.workspace (set by WorkspaceStage)
  const ws = ctx.workspace;
  if (!ws) {
    throw new Error('[file_read] Workspace not set in context');
  }

  const filePath = path.resolve(ws, args.path);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const totalLines = lines.length;

  // Handle different modes
  let startLine = 1;
  let endLine = totalLines;
  
  if (args.mode === "context" && args.line !== undefined) {
    // Context mode: read around a specific line with window size
    const targetLineIndex = Math.max(0, Math.min(totalLines - 1, args.line - 1));
    const windowSize = args.window || 100; // Default window of 100 lines
    const halfWindow = Math.floor(windowSize / 2);
    
    startLine = Math.max(1, targetLineIndex - halfWindow + 1);
    endLine = Math.min(totalLines, startLine + windowSize - 1);
    
    if (startLine === 1) {
      endLine = Math.min(totalLines, windowSize);
    } else if (endLine === totalLines) {
      startLine = Math.max(1, totalLines - windowSize + 1);
    }
  } else if (args.mode === "range" || (args.start_line !== undefined && args.end_line !== undefined)) {
    startLine = Math.max(1, args.start_line || 1);
    endLine = Math.min(totalLines, args.end_line || totalLines);
  } else if (args.mode === "full" || (args.start_line === undefined && args.end_line === undefined)) {
    startLine = 1;
    endLine = totalLines;
  }

  // Extract the actual content for this range
  const rangeContent = lines.slice(startLine - 1, endLine).join('\n');
  
  // For full mode, return plain text (most common use case)
  if (args.mode === "full" || (args.start_line === undefined && args.end_line === undefined)) {
    return rangeContent;
  }
  
  // Return buffer object for context/range modes
  return {
    bufferId: `buf_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    path: filePath,
    startLine,
    endLine,
    totalLines,
    content: rangeContent
  };
}
