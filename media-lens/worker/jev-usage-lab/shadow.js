// Shadow log for Jev recommendations.
//
// Records decisions and compares them to a label when one exists. Nothing
// here changes fusion, the live adapter, or flags. The env flag is read by
// scripts/jev-usage-lab.js, not by this module, so worker/config.js remains
// the only worker module that reads process.env.

export const SHADOW_ENV_NAME = 'MEDIA_LENS_JEV_SHADOW';

export function isShadowEnabled(env) {
  return Boolean(env) && env[SHADOW_ENV_NAME] === 'true';
}

export function createShadowLog() {
  const entries = [];
  return {
    record(entry) {
      entries.push(entry);
      return entry;
    },
    entries() {
      return entries.map((entry) => ({ ...entry }));
    },
    get acted() {
      return false;
    },
    get networkCalls() {
      return 0;
    }
  };
}
