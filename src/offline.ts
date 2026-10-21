import type { ConnState } from './usePlan';

/** How long the connection must stay down before we say so, so brief blips don't flash a banner. */
export const OFFLINE_DELAY_MS = 2000;

export const isDisconnected = (conn: ConnState) => conn === 'closed' || conn === 'connecting';

/** Reports `true` once the connection has been down for `delayMs`, and `false` as soon as it's back. */
export function offlineWatcher(onChange: (offline: boolean) => void, delayMs = OFFLINE_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let offline = false;
  const clear = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
  };
  return {
    update(conn: ConnState) {
      if (isDisconnected(conn)) {
        if (offline || timer != null) return;
        timer = setTimeout(() => {
          timer = null;
          offline = true;
          onChange(true);
        }, delayMs);
      } else {
        clear();
        if (offline) {
          offline = false;
          onChange(false);
        }
      }
    },
    dispose: clear,
  };
}
