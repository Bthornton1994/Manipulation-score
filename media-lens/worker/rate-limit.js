// Per-process rate and concurrency limiters for the Media Lens worker.
// Fixed windows (not sliding). Fail closed when a budget is exhausted or
// when a keyed map would grow without bound.

export function createFixedWindowLimiter(maxPerWindow, windowMs = 60000) {
  let windowStart = Date.now();
  let count = 0;
  return function checkAndIncrement() {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= maxPerWindow;
  };
}

export function createKeyedFixedWindowLimiter(maxPerWindow, windowMs = 60000, { maxKeys = 1024 } = {}) {
  const keys = new Map();

  function prune(now) {
    for (const [key, slot] of keys) {
      if (now - slot.windowStart >= windowMs) keys.delete(key);
    }
  }

  return function tryConsume(key) {
    const now = Date.now();
    if (maxPerWindow <= 0) return false;
    let slot = keys.get(key);
    if (!slot || now - slot.windowStart >= windowMs) {
      if (keys.size >= maxKeys) prune(now);
      if (keys.size >= maxKeys && !keys.has(key)) return false;
      slot = { windowStart: now, count: 0 };
      keys.set(key, slot);
    }
    if (slot.count >= maxPerWindow) return false;
    slot.count += 1;
    return true;
  };
}

export function createConcurrencyGate(maxConcurrent) {
  let inFlight = 0;
  return {
    tryEnter() {
      if (maxConcurrent <= 0) return false;
      if (inFlight >= maxConcurrent) return false;
      inFlight += 1;
      return true;
    },
    exit() {
      if (inFlight > 0) inFlight -= 1;
    },
    get inFlight() {
      return inFlight;
    }
  };
}
