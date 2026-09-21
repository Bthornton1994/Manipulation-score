// ESTIMATED TypeSafe (Jev) spend tracker with optional durable month counter.
// Figures are planning estimates only unless the operator has verified
// provider billing. Never records article or span text.

import {
  DEFAULT_TYPESAFE_BUDGET_STORE_FILE,
  readBudgetStore,
  TYPESAFE_BUDGET_STORE_VERSION,
  writeBudgetStore
} from './typesafe-budget-store.js';

export const DEFAULT_TYPESAFE_BUDGET = Object.freeze({
  estimatedUsdPerCall: 0.002,
  estimatedTokensPerCall: 1500,
  warnUsd: 20,
  stopUsd: 30
});

export function utcMonthKey(nowMs) {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function createTypesafeBudget({
  estimatedUsdPerCall = DEFAULT_TYPESAFE_BUDGET.estimatedUsdPerCall,
  estimatedTokensPerCall = DEFAULT_TYPESAFE_BUDGET.estimatedTokensPerCall,
  warnUsd = DEFAULT_TYPESAFE_BUDGET.warnUsd,
  stopUsd = DEFAULT_TYPESAFE_BUDGET.stopUsd,
  storePath = null,
  io = {},
  now = () => Date.now()
} = {}) {
  const currentMonth = utcMonthKey(now());
  const persisted = storePath ? readBudgetStore(storePath, io) : null;
  let month = persisted && persisted.month === currentMonth ? persisted.month : currentMonth;
  let calls = persisted && persisted.month === currentMonth ? persisted.calls : 0;
  let estimatedTokens = persisted && persisted.month === currentMonth ? persisted.estimatedTokens : 0;
  let warnEmitted = persisted && persisted.month === currentMonth ? persisted.warnEmitted : false;

  function persist() {
    if (!storePath) return;
    try {
      writeBudgetStore(
        storePath,
        {
          version: TYPESAFE_BUDGET_STORE_VERSION,
          month,
          calls,
          estimatedTokens,
          warnEmitted
        },
        io
      );
    } catch {
      // Best-effort durability: in-memory counters still apply for this process.
      // Production expects MEDIA_LENS_TYPESAFE_BUDGET_FILE (default
      // /var/lib/media-lens/typesafe-budget.json) to be writable by the worker user.
    }
  }

  function roll() {
    const current = utcMonthKey(now());
    if (current !== month) {
      month = current;
      calls = 0;
      estimatedTokens = 0;
      warnEmitted = false;
      persist();
    }
  }

  function estimatedUsdForCallCount(callCount) {
    return callCount * estimatedUsdPerCall;
  }

  return {
    getSnapshot() {
      roll();
      return {
        month,
        calls,
        estimatedTokens,
        estimatedUsd: estimatedUsdForCallCount(calls),
        basis: 'ESTIMATED',
        persisted: Boolean(storePath),
        calculationInputs: {
          estimatedUsdPerCall,
          estimatedTokensPerCall,
          warnUsd,
          stopUsd
        }
      };
    },
    isStopped() {
      roll();
      return estimatedUsdForCallCount(calls) >= stopUsd;
    },
    wouldExceed(additionalCalls = 1) {
      roll();
      const n = Number(additionalCalls);
      if (!Number.isFinite(n) || n < 0) return true;
      return estimatedUsdForCallCount(calls + n) > stopUsd;
    },
    recordCalls(callCount, { tokensPerCall = estimatedTokensPerCall } = {}) {
      roll();
      const n = Number(callCount);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error('typesafe budget recordCalls requires a non-negative integer');
      }
      calls += n;
      estimatedTokens += n * tokensPerCall;
      const estimatedUsd = estimatedUsdForCallCount(calls);
      let level = 'ok';
      if (estimatedUsd >= stopUsd) level = 'stopped';
      else if (estimatedUsd >= warnUsd) level = 'warn';
      const shouldWarn = estimatedUsd >= warnUsd && !warnEmitted;
      if (shouldWarn) warnEmitted = true;
      persist();
      return {
        month,
        calls,
        estimatedTokens,
        estimatedUsd,
        basis: 'ESTIMATED',
        level,
        shouldWarn,
        calculationInputs: {
          estimatedUsdPerCall,
          estimatedTokensPerCall,
          warnUsd,
          stopUsd,
          recordedCalls: n
        }
      };
    }
  };
}

export { DEFAULT_TYPESAFE_BUDGET_STORE_FILE };
