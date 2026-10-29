/** Minimal conditional LockManager fixture. Requests hold a name until their callback settles. */
export function createTestLockManager() {
  const held = new Set<string>();
  return {
    async request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) {
      if (!options.ifAvailable || options.steal) throw new Error('Fixture only permits conditional acquisition');
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name, mode: 'exclusive' } as Lock); }
      finally { held.delete(name); }
    },
    async query() { return { held: [...held].map(name => ({ name, mode: 'exclusive' })), pending: [] }; },
  } as unknown as LockManager;
}
