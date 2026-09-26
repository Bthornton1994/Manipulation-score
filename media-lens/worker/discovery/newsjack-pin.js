// The one reviewed Newsjack build that Media Lens accepts output from.
// Pure data. Every module takes the pin as an argument that defaults to this
// value, so tests can inject a pin for a fake binary without an override
// flag or environment variable existing in production.
//
// Upstream: https://github.com/elvisun/newsjack (MIT, Copyright (c) 2026
// Elvis Sun). See docs/NEWSJACK-LICENSE.md and media-lens/docs/newsjack-discovery.md.
//
// Tags are annotated but unsigned, release assets can be re-cut, and
// checksums.txt comes from the same origin as the binaries. Only the commit
// and the executed file's own sha256 identify what ran. Both binary hashes
// are null until the owner records one out of band, so no real Newsjack
// binary can run through the Media Lens runner today.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export const NEWSJACK_PIN = deepFreeze({
  upstream: 'https://github.com/elvisun/newsjack',
  version: 'v0.1.19',
  commit: 'bdb41b8d1f9a9e27221cc86102cbfe1a748fc123',
  tag_object: '8c20b879186363a939b1c4a7b626107d7df84c58',
  tag_signed: false,
  commit_signed: false,
  go_directive: '1.26',
  reviewed_at: '2026-09-26',
  license: {
    spdx: 'MIT',
    copyright: 'Copyright (c) 2026 Elvis Sun',
    blob: '3114ffd1cb756dbc47941e2c100cc27cb10d274a',
    sha256: 'a973d457a5ad23a36205ef48f88c5860680fed6a3d8fdc64df6f43cd0b3e413e'
  },
  trademark: {
    blob: '782ac8a6d87514281c8a4eca444ff3f84e61a206',
    sha256: '945f6a9e59cf898620c1d89deb500e44d18667b3ed86afacea82372d555d5545'
  },
  // Git blob ids at the pinned commit for the files whose output shapes and
  // process behavior media-lens/tools/newsjack-raw.js and
  // media-lens/tools/newsjack-runner.js encode. An upgrade re-reviews each.
  reviewed_emitters: {
    'apps/cli/cmd/newsjack/main.go': '8cf1fdc1e426b175777e01eb8f1ba21ae43bd9c8',
    'apps/cli/cmd/newsjack/detector_command.go': 'aeead2ef5029294aafa97698b0c62f02d851b206',
    'apps/cli/cmd/newsjack/detector_run.go': '7055aa1311e6e598b2d6b6680550fcc81d4b5f6e',
    'apps/cli/cmd/newsjack/detector_models.go': '8a8412ccabb482f7d9483869221fde29253bf15a',
    'apps/cli/cmd/newsjack/detector_profile.go': '2e3028b326f90ae802613dc18ca519d421bb8e16',
    'apps/cli/cmd/newsjack/detector_scoring.go': '16cf133ef11010b51dadfcc648871e0f0c93f94f',
    'apps/cli/cmd/newsjack/detector_sources.go': 'e25e1e3892fafa4bdf30731c6329ebb7d930078c',
    'apps/cli/cmd/newsjack/cluster.go': '3d363a6fcad9d0dd592c578d609772f29f5a8a6c',
    'apps/cli/cmd/newsjack/origin.go': '365890b9a8b8ee52bdf490ea227ab14b386e7460',
    'apps/cli/cmd/newsjack/filter.go': '6ad3ecb976c02ff88a989227b6ad2c87d0e68e75',
    'apps/cli/cmd/newsjack/util.go': 'd82ede05e8b6cf6b0a35415263da15029e352f58',
    'apps/cli/cmd/newsjack/json.go': 'bdef79b26a1fed13c1417799ada298401fa2426f',
    'apps/cli/cmd/newsjack/update.go': '837a4bae6b86d3b349574c7f0bd8780da779983d',
    'apps/cli/cmd/newsjack/paths.go': '3588d2d9f54bbfa8aaceb7ccea341b2993704556',
    'apps/cli/cmd/newsjack/http.go': '1d03f40339d9f9833a3b4af2c6069ec8489f49a4',
    'apps/cli/cmd/newsjack/distribution.go': '1922abe731eef43ce77268b9d72a55f79a98268d',
    'apps/cli/cmd/newsjack/auth.go': 'dae156da5050bd47660c3741edc0012247623b52',
    'apps/cli/cmd/newsjack/auth_oauth.go': '4622b7ba7ccfd1c7914f437031d3e3cec669821a',
    'apps/cli/cmd/newsjack/api_commands.go': '28afa99c310e139572ad7be41db3f2e42a4f6628',
    'apps/cli/cmd/newsjack/detector_store.go': 'a92d5026c571a5a5cbc4b92344546f1755a28a83',
    'apps/cli/cmd/newsjack/bundle.go': '13998e735af06c6cb02881439bd0c0199f26a0be',
    'apps/cli/cmd/newsjack/config.go': 'a9599fbe095ded215219b153c5a8d8e4fa979bca',
    'apps/cli/go.mod': '0e2f01059969b7f03561705751e508eadc33c25b'
  },
  // The only subcommands the runner ever executes.
  allowed_subcommands: ['version', 'detector run', 'cluster', 'origin-apply'],
  // sha256 of the exact executable per `${process.platform}-${process.arch}`.
  // null means no reviewed binary exists for that platform, and the runner
  // refuses to execute anything there.
  binaries: {
    'linux-x64': null,
    'linux-arm64': null
  }
});

export function pinnedBinarySha256(pin = NEWSJACK_PIN, platformKey = `${process.platform}-${process.arch}`) {
  const entry = pin?.binaries?.[platformKey];
  return typeof entry === 'string' && /^[a-f0-9]{64}$/.test(entry) ? entry : null;
}

export function recordedBinaryHashes(pin = NEWSJACK_PIN) {
  return Object.values(pin?.binaries || {}).filter((entry) => typeof entry === 'string' && /^[a-f0-9]{64}$/.test(entry));
}
