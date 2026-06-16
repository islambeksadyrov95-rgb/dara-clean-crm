// Same-tab signal that the current manager's callbacks changed (a disposition was
// recorded). The sidebar "перезвоны" badge counts only the current manager's own
// callbacks, and those change only via this manager's own actions in this browser —
// so a window event is a reliable, synchronous way to refresh the badge without
// depending on cross-client realtime delivery.
export const CALLBACKS_CHANGED_EVENT = 'dc:callbacks-changed'

export function notifyCallbacksChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CALLBACKS_CHANGED_EVENT))
  }
}
