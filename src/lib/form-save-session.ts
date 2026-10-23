/** Retains identities and acknowledged steps while a form retries a partial save. */
export function createFormSaveSession(createId: () => string = () => crypto.randomUUID()) {
  const ids = new Map<string, string>();
  const steps = new Map<string, Promise<unknown>>();

  return {
    id(key: string): string {
      const existing = ids.get(key);
      if (existing) return existing;
      const id = createId();
      ids.set(key, id);
      return id;
    },
    once<T>(key: string, save: () => Promise<T>): Promise<T> {
      const existing = steps.get(key);
      if (existing) return existing as Promise<T>;
      const pending = Promise.resolve().then(save).catch((error: unknown) => {
        steps.delete(key);
        throw error;
      });
      steps.set(key, pending);
      return pending;
    },
  };
}
