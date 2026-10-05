const clone = value => structuredClone(value);
export class MemoryCheckpointer {
  #items = new Map();
  async load(threadId) { return this.#items.has(threadId) ? clone(this.#items.get(threadId)) : null; }
  async save(threadId, checkpoint) { this.#items.set(threadId, clone(checkpoint)); return clone(checkpoint); }
}
