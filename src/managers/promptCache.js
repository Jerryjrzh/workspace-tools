// src/managers/promptCache.js
import fs from 'fs';
import path from 'path';

/**
 * Prompt Cache Manager - Avoids embedding large prompts in Tool JSON
 * Addresses the "Prompt Cache" requirement from review_gpt7.md
 */

export class PromptCacheManager {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || path.join(process.cwd(), '.prompt-cache');
    this.maxEntries = options.maxEntries || 100;
    this.maxAge = options.maxAge || 24 * 60 * 60 * 1000; // 24 hours
    this.cache = new Map();
    this.index = {};
    
    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    
    this.loadCache();
  }

  /**
   * Store a prompt in the cache
   */
  async storePrompt(prompt, metadata = {}) {
    const promptId = this.generatePromptId();
    const timestamp = Date.now();
    
    // Truncate very long prompts for display
    const displayContent = prompt.length > 1000 
      ? prompt.substring(0, 500) + '...[truncated]' + prompt.substring(prompt.length - 200)
      : prompt;

    const cacheEntry = {
      id: promptId,
      content: prompt,
      metadata: {
        ...metadata,
        createdAt: timestamp,
        displayContent,
        originalLength: prompt.length
      }
    };

    // Store in memory
    this.cache.set(promptId, cacheEntry);
    
    // Store to disk
    const filePath = path.join(this.cacheDir, `${promptId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(cacheEntry, null, 2));
    
    // Update index
    this.index[promptId] = {
      metadata: cacheEntry.metadata,
      filePath
    };
    
    // Prune old entries if needed
    await this.pruneCache();
    
    return promptId;
  }

  /**
   * Retrieve a prompt from the cache
   */
  async retrievePrompt(promptId) {
    // Check memory cache first
    const cached = this.cache.get(promptId);
    if (cached) {
      return {
        id: promptId,
        content: cached.content,
        metadata: cached.metadata
      };
    }

    // Load from disk
    const indexEntry = this.index[promptId];
    if (!indexEntry) {
      throw new Error(`Prompt not found: ${promptId}`);
    }

    const filePath = indexEntry.filePath;
    if (!fs.existsSync(filePath)) {
      throw new Error(`Cache file not found: ${filePath}`);
    }

    const cacheEntry = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Update memory cache
    this.cache.set(promptId, cacheEntry);
    
    return {
      id: promptId,
      content: cacheEntry.content,
      metadata: cacheEntry.metadata
    };
  }

  /**
   * Check if a prompt exists in the cache
   */
  async promptExists(promptId) {
    return this.cache.has(promptId) || !!this.index[promptId];
  }

  /**
   * Delete a prompt from the cache
   */
  async deletePrompt(promptId) {
    this.cache.delete(promptId);
    
    const indexEntry = this.index[promptId];
    if (indexEntry) {
      const filePath = indexEntry.filePath;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      delete this.index[promptId];
    }
  }

  /**
   * Generate a unique prompt ID
   */
  generatePromptId() {
    return `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Prune old cache entries
   */
  async pruneCache() {
    const now = Date.now();
    let deletedCount = 0;
    
    for (const [id, entry] of this.cache.entries()) {
      const age = now - entry.metadata.createdAt;
      if (age > this.maxAge) {
        await this.deletePrompt(id);
        deletedCount++;
      }
    }

    // Also check disk entries
    const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(this.cacheDir, file);
      const stat = fs.statSync(filePath);
      const age = now - stat.mtimeMs;
      
      if (age > this.maxAge) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Get cache statistics
   */
  getStatistics() {
    const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.json'));
    
    let totalSize = 0;
    for (const file of files) {
      const filePath = path.join(this.cacheDir, file);
      totalSize += fs.statSync(filePath).size;
    }

    return {
      memoryEntries: this.cache.size,
      diskEntries: files.length,
      totalSizeBytes: totalSize,
      maxEntries: this.maxEntries,
      maxAgeHours: this.maxAge / (1000 * 60 * 60)
    };
  }

  /**
   * Clear all cache entries
   */
  async clearCache() {
    this.cache.clear();
    
    const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      fs.unlinkSync(path.join(this.cacheDir, file));
    }
    
    this.index = {};
  }

  /**
   * Create a prompt reference for tool calls
   */
  createPromptReference(promptId) {
    return {
      prompt_id: promptId,
      type: 'cached_prompt',
      cached_at: new Date().toISOString()
    };
  }

  /**
   * Resolve a prompt reference to actual content
   */
  async resolvePromptReference(reference) {
    if (reference.type !== 'cached_prompt') {
      throw new Error(`Unknown prompt reference type: ${reference.type}`);
    }
    
    return this.retrievePrompt(reference.prompt_id);
  }
}

// Singleton instance
export const promptCacheManager = new PromptCacheManager();