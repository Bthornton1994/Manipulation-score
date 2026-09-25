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
  const persisted = storePath ? readBudgetStore(storePath, io) : null;
  let month = persisted && persisted.month === currentMonth ? persisted.month : currentMonth;
  let calls = persisted && persisted.month === currentMonth ? persisted.calls : 0;
  let estimatedTokens = persisted && persisted.month === currentMonth ? persisted.estimatedTokens : 0;
  let warnEmitted = persisted && persisted.month === currentMonth ? persisted.warnEmitted : false;
  let pendingReservationOutcome = null;

  function syncFromRecord(record) {
    if (!record) return;
    month = record.month;
    calls = record.calls;
    estimatedTokens = record.estimatedTokens;
    warnEmitted = record.warnEmitted;
  }

  function refreshFromStore() {
    if (!storePath) return;
    try {
      const record = mutateBudgetStore(
        storePath,
        (current) => {
          const activeMonth = utcMonthKey(now());
          if (current && current.month === activeMonth) {
            syncFromRecord(current);
          } else if (activeMonth !== month) {
            month = activeMonth;
            calls = 0;
            estimatedTokens = 0;
            warnEmitted = false;
          }
          return null;
        },
        io
      );
      if (record) syncFromRecord(record);
    } catch {
      // Best-effort refresh when the store path is unavailable.
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

  function recordCallsImpl(callCount, { tokensPerCall = estimatedTokensPerCall } = {}) {
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
        calculationInputs: {
          estimatedUsdPerCall,
          estimatedTokensPerCall,
          warnUsd,
          stopUsd
        }
      };
    },
    isStopped() {
      refreshFromStore();
      roll();
      return estimatedUsdForCallCount(calls) >= stopUsd;
    },
    wouldExceed(additionalCalls = 1) {
      refreshFromStore();
      roll();
      const n = Number(additionalCalls);
      if (!Number.isFinite(n) || n < 0) return true;
      return estimatedUsdForCallCount(calls + n) > stopUsd;
    },
    /**
     * Atomically reserve up to callCount against the stop threshold before live
     * Jev work starts. Prevents concurrent analyses from both passing a
     * read-only wouldExceed check and overspending. Pair with
     * finalizeReservedCalls after the pipeline completes.
     */
    tryReserveCalls(callCount) {
      const n = Number(callCount);
      if (!Number.isInteger(n) || n < 0) return { ok: false };
      refreshFromStore();
      roll();
      const activeMonth = utcMonthKey(now());

      if (!storePath) {
        const priorUsd = estimatedUsdForCallCount(calls);
        const nextCalls = calls + n;
        if (estimatedUsdForCallCount(nextCalls) > stopUsd) return { ok: false };
        calls = nextCalls;
        estimatedTokens += n * estimatedTokensPerCall;
        const estimatedUsd = estimatedUsdForCallCount(calls);
        const shouldWarn = estimatedUsd >= warnUsd && priorUsd < warnUsd;
        if (estimatedUsd >= warnUsd) warnEmitted = true;
        pendingReservationOutcome = { reserved: n, shouldWarn };
        return { ok: true, reserved: n, shouldWarn };
      }

      try {
        let shouldWarn = false;
        let rejected = false;
        const record = mutateBudgetStore(
          storePath,
          (current) => {
            const base =
              current && current.month === activeMonth ? current : emptyRecord(activeMonth);
            const priorUsd = estimatedUsdForCallCount(base.calls);
            const nextCalls = base.calls + n;
            const nextEstimatedUsd = estimatedUsdForCallCount(nextCalls);
            if (nextEstimatedUsd > stopUsd) {
              rejected = true;
              return null;
            }
            const nextTokens = base.estimatedTokens + n * estimatedTokensPerCall;
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
        if (rejected) return { ok: false };
        syncFromRecord(record);
        pendingReservationOutcome = { reserved: n, shouldWarn };
        return { ok: true, reserved: n, shouldWarn };
      } catch {
        return { ok: false };
      }
    },
    /**
     * Release unused reservation and record the actual Jev call count for this
     * analysis. No-op when reserved equals actual.
     */
    finalizeReservedCalls(reserved, actual, { tokensPerCall = estimatedTokensPerCall } = {}) {
      const r = Number(reserved);
      const a = Number(actual);
      if (!Number.isInteger(r) || r < 0 || !Number.isInteger(a) || a < 0) {
        throw new Error('typesafe budget finalizeReservedCalls requires non-negative integers');
      }
      const delta = a - r;
      if (delta === 0) {
        refreshFromStore();
        roll();
        return buildRecordResult(
          {
            version: TYPESAFE_BUDGET_STORE_VERSION,
            month,
            calls,
            estimatedTokens,
            warnEmitted
          },
          { recordedCalls: a, shouldWarn: false }
        );
      }
      if (delta > 0) {
        return recordCallsImpl(delta, { tokensPerCall });
      }
      const release = -delta;
      const activeMonth = utcMonthKey(now());

      if (!storePath) {
        roll();
        calls = Math.max(0, calls - release);
        estimatedTokens = Math.max(0, estimatedTokens - release * tokensPerCall);
        return buildRecordResult(
          {
            version: TYPESAFE_BUDGET_STORE_VERSION,
            month,
            calls,
            estimatedTokens,
            warnEmitted
          },
          { recordedCalls: a, shouldWarn: false }
        );
      }

      try {
        const record = mutateBudgetStore(
          storePath,
          (current) => {
            const base =
              current && current.month === activeMonth ? current : emptyRecord(activeMonth);
            return {
              version: TYPESAFE_BUDGET_STORE_VERSION,
              month: activeMonth,
              calls: Math.max(0, base.calls - release),
              estimatedTokens: Math.max(0, base.estimatedTokens - release * tokensPerCall),
              warnEmitted: base.warnEmitted
            };
          },
          io
        );
        syncFromRecord(record);
        return buildRecordResult(record, { recordedCalls: a, shouldWarn: false });
      } catch {
        roll();
        calls = Math.max(0, calls - release);
        estimatedTokens = Math.max(0, estimatedTokens - release * tokensPerCall);
        return buildRecordResult(
          {
            version: TYPESAFE_BUDGET_STORE_VERSION,
            month,
            calls,
            estimatedTokens,
            warnEmitted
          },
          { recordedCalls: a, shouldWarn: false }
        );
      }
    },
    consumeReservationOutcome() {
      const outcome = pendingReservationOutcome;
      pendingReservationOutcome = null;
      return outcome;
    },
    recordCalls: recordCallsImpl
  };
}

export { DEFAULT_TYPESAFE_BUDGET_STORE_FILE };
