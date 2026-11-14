const listeners = new Set<() => void>();
export function accessChanged() {
  for (const listener of listeners) listener();
}
export function onAccessChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
