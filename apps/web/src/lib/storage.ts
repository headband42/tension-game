// Small wrappers around localStorage, which can be missing or throw (private mode, blocked storage).

const PREFIX = 'tension:';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Nothing to do: the value simply won't survive a reload.
  }
}

let cachedDeviceId: string | null = null;

/**
 * A random id for this browser, so a player who refreshes or loses connection
 * rejoins as themselves. crypto.randomUUID needs HTTPS, so build one from
 * getRandomValues, which works on plain-HTTP LAN addresses too.
 */
export function deviceId(): string {
  cachedDeviceId ??= read('device');
  if (!cachedDeviceId) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    cachedDeviceId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    write('device', cachedDeviceId);
  }
  return cachedDeviceId;
}

export const savedName = () => read('name') ?? '';
export const saveName = (name: string) => write('name', name);

export const hostToken = (code: string) => read(`host:${code}`);
export const saveHostToken = (code: string, token: string) => write(`host:${code}`, token);
