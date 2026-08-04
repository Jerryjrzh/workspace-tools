// src/runtime/EventBus.js
import { EventEmitter } from 'events';

/**
 * Domain event names emitted by AgentRuntime / stages.
 *
 * Per docs/CONTEXT_CONTRACT.md §6, Memory / Telemetry / Log / Plugin / UI /
 * Streaming all subscribe as Observers rather than calling each other directly.
 */
export const DOMAIN_EVENTS = {
  BeforeTool: 'BeforeTool',
  AfterTool: 'AfterTool',
  ContextBuilt: 'ContextBuilt',
  MemoryLoaded: 'MemoryLoaded',
  SessionStarted: 'SessionStarted',
  WorkspaceChanged: 'WorkspaceChanged'
};

/**
 * EventBus - structured domain event emitter.
 *
 * Wraps Node's EventEmitter with typed helpers and a subscriber registry so
 * Observers can be added/removed without coupling to the runtime internals.
 */
export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Emit a domain event with structured payload.
   * @param {string} name - one of DOMAIN_EVENTS
   * @param {Object} payload
   */
  emitDomain(name, payload = {}) {
    return super.emit(name, {
      ...payload,
      timestamp: Date.now(),
      eventName: name
    });
  }

  /** Convenience aliases for the core domain events */
  beforeTool(payload) {
    return this.emitDomain(DOMAIN_EVENTS.BeforeTool, payload);
  }
  afterTool(payload) {
    return this.emitDomain(DOMAIN_EVENTS.AfterTool, payload);
  }
  contextBuilt(payload) {
    return this.emitDomain(DOMAIN_EVENTS.ContextBuilt, payload);
  }
  memoryLoaded(payload) {
    return this.emitDomain(DOMAIN_EVENTS.MemoryLoaded, payload);
  }
  sessionStarted(payload) {
    return this.emitDomain(DOMAIN_EVENTS.SessionStarted, payload);
  }
  workspaceChanged(payload) {
    return this.emitDomain(DOMAIN_EVENTS.WorkspaceChanged, payload);
  }

  /**
   * Subscribe an observer to a domain event.
   * @returns {Function} unsubscribe
   */
  onDomain(name, handler) {
    const wrapped = (payload) => handler(payload);
    super.on(name, wrapped);
    return () => super.removeListener(name, wrapped);
  }
}

export const eventBus = new EventBus();
export default EventBus;
