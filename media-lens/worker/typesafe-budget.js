// ESTIMATED TypeSafe (Jev) spend tracker with optional durable month counter.
// Figures are planning estimates only unless the operator has verified
// provider billing. Never records article or span text.

import {
  DEFAULT_TYPESAFE_BUDGET_STORE_FILE,
  mutateBudgetStore,
  readBudgetStore,
  TYPESAFE_BUDGET_STORE_VERSION
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

function emptyRecord(month) {
  return {
    version: TYPESAFE_BUDGET_STORE_VERSION,
    month,
    calls: 0,
    estimatedTokens: 0,
    warnEmitted: false
  };
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
  let storeUnavailable = false;
  let persisted = null;
  if (storePath) {
    try {
      persisted = readBudgetStore(storePath, io);
    } catch {
      storeUnavailable = true;
    }
  }
  let month = persisted && persisted.month === currentMonth ? persisted.month : currentMonth;
  let calls = persisted && persisted.month === currentMonth ? persisted.calls : 0;
  let estimatedTokens = persisted && persisted.month === currentMonth ? persisted.estimatedTokens : 0;
  let warnEmitted = persisted && persisted.month === currentMonth ? persisted.warnEmitted : false;

  function syncFromRecord(record) {
    if (!record) return;
    if (record.month === month) {
      // Never lower same-month counters. The in-memory count can be ahead of
      // the file after a failed durable write, and a stale file must not erase
      // calls this process already made.
      calls = Math.max(calls, record.calls);
      estimatedTokens = Math.max(estimatedTokens, record.estimatedTokens);
      warnEmitted = warnEmitted || record.warnEmitted;
      return;
    }
    month = record.month;
    calls = record.calls;
    estimatedTokens = record.estimatedTokens;
    warnEmitted = record.warnEmitted;
  }

  function refreshFromStore() {
    if (!storePath) return;
    try {
      const record = readBudgetStore(storePath, io);
      const activeMonth = utcMonthKey(now());
      if (record && record.month === activeMonth) {
        syncFromRecord(record);
      } else if (activeMonth !== month) {
        month = activeMonth;
        calls = 0;
        estimatedTokens = 0;
        warnEmitted = false;
      }
    } catch {
      storeUnavailable = true;
    }
  }

  function persistInMemoryRecord() {
    if (!storePath) return;
    try {
      mutateBudgetStore(
        storePath,
        () => ({
          version: TYPESAFE_BUDGET_STORE_VERSION,
          month,
          calls,
          estimatedTokens,
          warnEmitted
        }),
        io
      );
    } catch {
      // Best-effort durability: in-memory counters still apply for this process.
    }
  }

  function roll() {
    const current = utcMonthKey(now());
    if (current !== month) {
      month = current;
      calls = 0;
      estimatedTokens = 0;
      warnEmitted = false;
      persistInMemoryRecord();
    }
  }

  function estimatedUsdForCallCount(callCount) {
    return callCount * estimatedUsdPerCall;
  }

  function buildRecordResult(record, { recordedCalls, shouldWarn }) {
    const estimatedUsd = estimatedUsdForCallCount(record.calls);
    let level = 'ok';
    if (estimatedUsd >= stopUsd) level = 'stopped';
    else if (estimatedUsd >= warnUsd) level = 'warn';
    return {
      month: record.month,
      calls: record.calls,
      estimatedTokens: record.estimatedTokens,
      estimatedUsd,
      basis: 'ESTIMATED',
      level,
      shouldWarn,
      calculationInputs: {
        estimatedUsdPerCall,
        estimatedTokensPerCall,
        warnUsd,
        stopUsd,
        recordedCalls
      }
    };
  }

  return {
    getSnapshot() {
      refreshFromStore();
      roll();
      return {
        month,
        calls,
        estimatedTokens,
        estimatedUsd: estimatedUsdForCallCount(calls),
        basis: 'ESTIMATED',
        persisted: Boolean(storePath),
        storeUnavailable,
        calculationInputs: {
          estimatedUsdPerCall,
          estimatedTokensPerCall,
          warnUsd,
          stopUsd
        }
      };
    },
    // Fail-closed state for a persisted record that could not be read, was
    // invalid, or could not be updated. It is reported separately so callers
    // do not claim spend reached the stop.
    isStoreUnavailable() {
      if (!storeUnavailable) refreshFromStore();
      return storeUnavailable;
    },
    isStopped() {
      if (storeUnavailable) return true;
      refreshFromStore();
      if (storeUnavailable) return true;
      roll();
      return estimatedUsdForCallCount(calls) >= stopUsd;
    },
    wouldExceed(additionalCalls = 1) {
      if (storeUnavailable) return true;
      refreshFromStore();
      if (storeUnavailable) return true;
      roll();
      const n = Number(additionalCalls);
      if (!Number.isFinite(n) || n < 0) return true;
      return estimatedUsdForCallCount(calls + n) > stopUsd;
    },
    recordCalls(callCount, { tokensPerCall = estimatedTokensPerCall } = {}) {
      const n = Number(callCount);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error('typesafe budget recordCalls requires a non-negative integer');
      }
      const activeMonth = utcMonthKey(now());

      if (storePath) {
        try {
          let shouldWarn = false;
          const record = mutateBudgetStore(
            storePath,
            (current) => {
              const base =
                current && current.month === activeMonth ? current : emptyRecord(activeMonth);
              const priorUsd = estimatedUsdForCallCount(base.calls);
              const nextCalls = base.calls + n;
              const nextTokens = base.estimatedTokens + n * tokensPerCall;
              const nextEstimatedUsd = estimatedUsdForCallCount(nextCalls);
              shouldWarn = nextEstimatedUsd >= warnUsd && priorUsd < warnUsd;
              return {
                version: TYPESAFE_BUDGET_STORE_VERSION,
                month: activeMonth,
                calls: nextCalls,
                estimatedTokens: nextTokens,
                warnEmitted: base.warnEmitted || nextEstimatedUsd >= warnUsd
              };
            },
            io
          );
          syncFromRecord(record);
          return buildRecordResult(record, { recordedCalls: n, shouldWarn });
        } catch {
          roll();
          const priorUsd = estimatedUsdForCallCount(calls);
          calls += n;
          estimatedTokens += n * tokensPerCall;
          // Fail closed: once the durable record cannot be updated, the stop
          // can no longer be enforced across restarts or processes, so later
          // live analyses abstain until an operator repairs it and restarts.
          storeUnavailable = true;
          const estimatedUsd = estimatedUsdForCallCount(calls);
          const shouldWarn = estimatedUsd >= warnUsd && priorUsd < warnUsd;
          if (estimatedUsd >= warnUsd) warnEmitted = true;
          return buildRecordResult(
            {
              version: TYPESAFE_BUDGET_STORE_VERSION,
              month,
              calls,
              estimatedTokens,
              warnEmitted
            },
            { recordedCalls: n, shouldWarn }
          );
        }
      }

      roll();
      calls += n;
      estimatedTokens += n * tokensPerCall;
      const estimatedUsd = estimatedUsdForCallCount(calls);
      let level = 'ok';
      if (estimatedUsd >= stopUsd) level = 'stopped';
      else if (estimatedUsd >= warnUsd) level = 'warn';
      const shouldWarn = estimatedUsd >= warnUsd && !warnEmitted;
      if (shouldWarn) warnEmitted = true;
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
