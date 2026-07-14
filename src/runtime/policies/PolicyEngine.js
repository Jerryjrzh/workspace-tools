class PolicyEngine {
  constructor(policies = []) {
    this.policies = policies;
  }

  use(policy) {
    this.policies.push(policy);
    return this;
  }

  async run(ctx, next) {
    let index = -1;

    const dispatch = async (i) => {
      if (i <= index) {
        throw new Error('next() called multiple times in a single policy');
      }
      index = i;

      if (i === this.policies.length) {
        return next();
      }

      const policy = this.policies[i];
      return policy(ctx, () => dispatch(i + 1));
    };

    return dispatch(0);
  }
}

export { PolicyEngine };
export default PolicyEngine;
