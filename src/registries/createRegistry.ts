// ============================================================================
// Generic Registry Factory
// ============================================================================
// Eliminates boilerplate across transition, idle behavior, generator, and
// formation library registries. Each registry is a Map<string, T> with
// register/get/getAll operations.
// ============================================================================

export interface Registry<T extends { id: string }> {
  register: (def: T) => void
  get: (id: string) => T | undefined
  getAll: () => T[]
}

export function createRegistry<T extends { id: string }>(name: string): Registry<T> {
  const map = new Map<string, T>()
  return {
    register(def: T) {
      if (map.has(def.id)) {
        console.warn(`[${name}] Overwriting existing entry '${def.id}'`)
      }
      map.set(def.id, def)
    },
    get(id: string) {
      return map.get(id)
    },
    getAll() {
      return [...map.values()]
    },
  }
}
