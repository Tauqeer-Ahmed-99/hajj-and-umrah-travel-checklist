const listeners = new Set<() => void>();

// Content-free acceptance signal. A new authorized read determines what can
// remain scheduled; an old form/response never supplies notification authority.
export function acceptedTravelChange() {
  for (const listener of listeners) listener();
}
export function onAcceptedTravelChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
