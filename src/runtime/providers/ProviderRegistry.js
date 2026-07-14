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
}

export { ProviderRegistry };
export default ProviderRegistry;
