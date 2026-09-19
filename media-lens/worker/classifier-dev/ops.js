// In-process circuit breaker and daily classification budget for the
// classifier.dev evaluation adapter. State is per worker process.

export function utcDayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function createCircuitBreaker({
  failureThreshold = 3,
  resetMs = 60000,
  now = () => Date.now()
} = {}) {
  let failures = 0;
  let openedAt = null;
  return {
    isOpen() {
      if (openedAt == null) return false;
      if (now() - openedAt >= resetMs) {
        openedAt = null;
        failures = 0;
        return false;
      }
      return true;
    },
    recordSuccess() {
      failures = 0;
      openedAt = null;
    },
    recordFailure() {
      failures += 1;
      if (failures >= failureThreshold) openedAt = now();
    },
    get failures() {
      return failures;
    }
  };
}

export function createDailyBudget(maxPerDay, { now = () => Date.now() } = {}) {
  let day = utcDayKey(now());
  let used = 0;
  function roll() {
    const current = utcDayKey(now());
    if (current !== day) {
      day = current;
      used = 0;
    }
  }
  return {
    remaining() {
      roll();
      if (maxPerDay <= 0) return 0;
      return Math.max(0, maxPerDay - used);
    },
    tryConsume(count) {
      roll();
      const n = Number(count);
      if (!Number.isInteger(n) || n <= 0) return false;
      if (maxPerDay <= 0) return false;
      if (used + n > maxPerDay) return false;
      used += n;
      return true;
    },
    get used() {
      roll();
      return used;
    }
  };
}

export function createConcurrencyGate(maxConcurrent) {
  let inFlight = 0;
  const waiters = [];
  return {
    async enter() {
      if (maxConcurrent <= 0) {
        throw Object.assign(new Error('classifier.dev concurrency is 0'), { code: 'concurrency_zero' });
      }
      if (inFlight < maxConcurrent) {
        inFlight += 1;
        return;
      }
      await new Promise((resolve) => waiters.push(resolve));
      inFlight += 1;
    },
    exit() {
      if (inFlight > 0) inFlight -= 1;
      const next = waiters.shift();
      if (next) next();
    },
    get inFlight() {
      return inFlight;
    }
  };
}
