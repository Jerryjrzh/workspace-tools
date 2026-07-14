export class GuardPolicy {
  constructor(name, handler) {
    this.name = name;
    this.handler = handler;
  }

  async run(ctx, next) {
    return this.handler(ctx, next);
  }
}

export default GuardPolicy;
