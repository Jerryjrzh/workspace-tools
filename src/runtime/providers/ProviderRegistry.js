class ProviderRegistry {
  constructor(providers = {}) {
    this.providers = providers;
  }

  get(name) {
    return this.providers[name] || null;
  }

  register(name, provider) {
    this.providers[name] = provider;
    return this;
  }

  /** Dispose all registered providers (release watchers/resources). */
  async disposeAll() {
    const results = [];
    for (const [name, provider] of Object.entries(this.providers)) {
      if (provider && typeof provider.dispose === 'function') {
        try {
          await provider.dispose();
          results.push({ name, disposed: true });
        } catch (_err) {
          results.push({ name, disposed: false });
        }
      }
    }
    return results;
  }

  list() {
    return Object.keys(this.providers);
  }
}

export { ProviderRegistry };
export default ProviderRegistry;
