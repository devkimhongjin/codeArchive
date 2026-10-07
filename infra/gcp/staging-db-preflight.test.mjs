import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PreflightError,
  createPreflightPlan,
  makeGcloudReader,
  renderBindings,
} from './staging-db-preflight.mjs';

const REGION = 'asia-southeast1';
const PROJECT = 'synthetic-project';
const API = 'synthetic-api-stg';
const WORKER = 'synthetic-worker-stg';

function alias(name, canonicalDatabaseId, prefix, version = '7') {
  return {
    alias: name,
    canonicalDatabaseId,
    evidence: `synthetic:${name}`,
    secretVersions: {
      url: { name: `${prefix}-url`, version },
      username: { name: `${prefix}-username`, version },
      password: { name: `${prefix}-password`, version },
    },
  };
}

function service(serviceName, role, datasourceAlias) {
  return {
    project: PROJECT,
    region: REGION,
    service: serviceName,
    role,
    datasourceAlias,
    evidence: `synthetic:${serviceName}`,
    springProfile: 'prod',
  };
}

function verifiedPolicy({
  apiRole = 'nonproduction',
  workerRole = 'nonproduction',
  apiAlias = 'staging-pool',
  workerAlias = 'staging-direct',
  protectedProductionDatabases = ['neon:prod:main:codearchive:codearchive_v2'],
  aliases,
  approvedNonproductionDatabases,
} = {}) {
  const resolvedAliases = aliases ?? [
    alias('staging-pool', 'neon:staging:isolated:codearchive:codearchive_v2', 'staging-pool'),
    alias('staging-direct', 'neon:staging:isolated:codearchive:codearchive_v2', 'staging-direct'),
  ];
  const resolvedApprovedDatabases = approvedNonproductionDatabases ?? [
    ...new Set(resolvedAliases.map((entry) => entry.canonicalDatabaseId)),
  ].map((canonicalDatabaseId) => ({ canonicalDatabaseId, evidence: `synthetic:${canonicalDatabaseId}` }));
  return {
    schemaVersion: 1,
    inventoryStatus: 'verified',
    reviewedAt: '2026-09-21T00:00:00Z',
    validUntil: '2099-12-31T00:00:00Z',
    services: [
      service(API, apiRole, apiAlias),
      service(WORKER, workerRole, workerAlias),
    ],
    datasourceAliases: resolvedAliases,
    approvedNonproductionDatabases: resolvedApprovedDatabases,
    protectedProductionDatabases,
  };
}

function cloudRunService(secretPrefix, key = 'latest', extraEnv = []) {
  return {
    spec: {
      template: {
        spec: {
          containers: [{
            env: [
              { name: 'SPRING_PROFILES_ACTIVE', value: 'prod' },
              { name: 'SPRING_DATASOURCE_URL', valueFrom: { secretKeyRef: { name: `${secretPrefix}-url`, key } } },
              { name: 'SPRING_DATASOURCE_USERNAME', valueFrom: { secretKeyRef: { name: `${secretPrefix}-username`, key } } },
              { name: 'SPRING_DATASOURCE_PASSWORD', valueFrom: { secretKeyRef: { name: `${secretPrefix}-password`, key } } },
              ...extraEnv,
            ],
          }],
        },
      },
    },
  };
}

function withSecretMappings(serviceDocument, value) {
  serviceDocument.spec.template.metadata = {
    annotations: { 'run.googleapis.com/secrets': value },
  };
  return serviceDocument;
}

function request() {
  return {
    project: PROJECT,
    region: REGION,
    targets: [
      { targetRole: 'api', service: API },
      { targetRole: 'worker', service: WORKER },
    ],
  };
}

function readers({ apiPrefix = 'staging-pool', workerPrefix = 'staging-direct', version = '7', apiService, workerService } = {}) {
  const services = new Map([
    [API, apiService ?? cloudRunService(apiPrefix)],
    [WORKER, workerService ?? cloudRunService(workerPrefix)],
  ]);
  return {
    loadService: async ({ service: serviceName }) => services.get(serviceName),
    resolveSecretVersion: async (_secret, reference = 'latest') => reference === 'latest' ? version : reference,
  };
}

async function expectDenied(code, fn) {
  await assert.rejects(fn, (error) => error instanceof PreflightError && error.code === code);
}

test('verified isolated API and worker produce a pinned numeric execution plan', async () => {
  const r = readers();
  const plan = await createPreflightPlan({
    policy: verifiedPolicy(),
    request: request(),
    ...r,
    now: () => '2026-09-21T00:00:00Z',
  });

  assert.equal(plan.targets.length, 2);
  assert.equal(plan.targets[0].canonicalDatabaseId, plan.targets[1].canonicalDatabaseId);
  const apiBindings = renderBindings(plan, API);
  assert.match(apiBindings, /SPRING_DATASOURCE_URL=staging-pool-url:7/);
  assert.match(apiBindings, /SPRING_DATASOURCE_USERNAME=staging-pool-username:7/);
  assert.match(apiBindings, /SPRING_DATASOURCE_PASSWORD=staging-pool-password:7/);
  assert.doesNotMatch(apiBindings, /latest/);
});

test('API and worker mapped to different canonical databases are rejected', async () => {
  const r = readers();
  const policy = verifiedPolicy({
    aliases: [
      alias('staging-pool', 'neon:staging:api:codearchive:codearchive_v2', 'staging-pool'),
      alias('staging-direct', 'neon:staging:worker:codearchive:codearchive_v2', 'staging-direct'),
    ],
  });

  await expectDenied('PAIRED_DATABASE_IDENTITY_MISMATCH', () => createPreflightPlan({
    policy,
    request: request(),
    ...r,
    now: () => '2026-09-21T00:00:00Z',
  }));
});

test('initial unverified inventory is fail-closed', async () => {
  const r = readers();
  await expectDenied('POLICY_INVENTORY_UNVERIFIED', () => createPreflightPlan({
    policy: {
      schemaVersion: 1,
      inventoryStatus: 'blocked_pending_verified_inventory',
      reviewedAt: null,
      validUntil: null,
      services: [],
      datasourceAliases: [],
      approvedNonproductionDatabases: [],
      protectedProductionDatabases: [],
    },
    request: request(),
    ...r,
  }));
});


test('expired verified inventory is rejected', async () => {
  const r = readers();
  const policy = verifiedPolicy();
  policy.validUntil = '2026-09-21T00:00:01Z';
  await expectDenied('POLICY_INVENTORY_EXPIRED', () => createPreflightPlan({
    policy,
    request: request(),
    ...r,
    now: () => '2026-09-22T00:00:00Z',
  }));
});

test('duplicate Spring datasource env is rejected as ambiguous', async () => {
  const bad = cloudRunService('staging-pool', 'latest', [
    { name: 'SPRING_DATASOURCE_URL', valueFrom: { secretKeyRef: { name: 'other-url', key: '7' } } },
  ]);
  const r = readers({ apiService: bad });
  await expectDenied('SPRING_ENV_DUPLICATED', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
    now: () => '2026-09-21T00:00:00Z',
  }));
});

test('stg-named service registered as production is rejected', async () => {
  const r = readers();
  await expectDenied('PRODUCTION_SERVICE_BLOCKED', () => createPreflightPlan({
    policy: verifiedPolicy({ apiRole: 'production' }),
    request: request(),
    ...r,
  }));
});

test('registered pool/direct aliases that resolve to a protected production DB are both rejected', async () => {
  const prod = 'neon:prod:main:codearchive:codearchive_v2';
  const policy = verifiedPolicy({
    aliases: [
      alias('staging-pool', prod, 'staging-pool'),
      alias('staging-direct', prod, 'staging-direct'),
    ],
    protectedProductionDatabases: [prod],
  });
  const r = readers();
  await expectDenied('PRODUCTION_DATABASE_BLOCKED', () => createPreflightPlan({ policy, request: request(), ...r }));
});

test('missing or unregistered alias is rejected instead of inferred from URL or username', async () => {
  const policy = verifiedPolicy();
  policy.services[0].datasourceAlias = 'unregistered-pool-alias';
  const r = readers();
  await expectDenied('DATASOURCE_ALIAS_NOT_REGISTERED', () => createPreflightPlan({ policy, request: request(), ...r }));
});

test('missing canonical database identity is rejected', async () => {
  const policy = verifiedPolicy();
  delete policy.datasourceAliases[0].canonicalDatabaseId;
  const r = readers();
  await expectDenied('CANONICAL_DATABASE_ID_MISSING', () => createPreflightPlan({
    policy, request: request(), ...r,
  }));
});

test('canonical database identity without positive nonproduction registration is rejected', async () => {
  const r = readers();
  const policy = verifiedPolicy({
    approvedNonproductionDatabases: [{
      canonicalDatabaseId: 'neon:staging:other:codearchive:codearchive_v2',
      evidence: 'synthetic:other-database',
    }],
  });
  await expectDenied('NONPRODUCTION_DATABASE_NOT_REGISTERED', () => createPreflightPlan({
    policy, request: request(), ...r,
  }));
});

test('duplicate nonproduction database registration is rejected as ambiguous', async () => {
  const r = readers();
  const canonicalDatabaseId = 'neon:staging:isolated:codearchive:codearchive_v2';
  const policy = verifiedPolicy({
    approvedNonproductionDatabases: [
      { canonicalDatabaseId, evidence: 'synthetic:database-a' },
      { canonicalDatabaseId, evidence: 'synthetic:database-b' },
    ],
  });
  await expectDenied('NONPRODUCTION_DATABASE_NOT_REGISTERED', () => createPreflightPlan({
    policy, request: request(), ...r,
  }));
});

test('duplicate datasource aliases are rejected as ambiguous', async () => {
  const policy = verifiedPolicy();
  policy.datasourceAliases.push({ ...policy.datasourceAliases[0] });
  const r = readers();
  await expectDenied('DATASOURCE_ALIAS_NOT_REGISTERED', () => createPreflightPlan({
    policy, request: request(), ...r,
  }));
});

test('cross-project Cloud Run secret alias mapping is rejected', async () => {
  const bad = withSecretMappings(cloudRunService('staging-pool'), [
    'staging-pool-url:projects/other-project/secrets/staging-pool-url',
    'staging-pool-username:projects/other-project/secrets/staging-pool-username',
    'staging-pool-password:projects/other-project/secrets/staging-pool-password',
  ].join(','));
  const r = readers({ apiService: bad });
  await expectDenied('DATASOURCE_SECRET_PROJECT_MISMATCH', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
  }));
});

test('ambiguous Cloud Run secret alias mapping is rejected', async () => {
  const bad = withSecretMappings(cloudRunService('staging-pool'), [
    'staging-pool-url:projects/synthetic-project/secrets/staging-pool-url',
    'staging-pool-url:projects/synthetic-project/secrets/other-url',
  ].join(','));
  const r = readers({ apiService: bad });
  await expectDenied('SECRET_MAPPING_INVALID', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
  }));
});

test('qualified secret resource names are not accepted as policy bindings', async () => {
  const policy = verifiedPolicy();
  policy.datasourceAliases[0].secretVersions.url.name = 'projects/other-project/secrets/staging-pool-url';
  const r = readers();
  await expectDenied('DATASOURCE_SECRET_NAME_INVALID', () => createPreflightPlan({
    policy, request: request(), ...r,
  }));
});

test('plain datasource override is rejected', async () => {
  const bad = cloudRunService('staging-pool');
  bad.spec.template.spec.containers[0].env[1] = {
    name: 'SPRING_DATASOURCE_URL',
    value: 'jdbc:postgresql://sentinel.invalid/db?password=SENTINEL_PASSWORD',
  };
  const r = readers({ apiService: bad });
  await expectDenied('PLAINTEXT_DATASOURCE_OVERRIDE', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
  }));
});

test('unmodeled Hikari datasource override is rejected', async () => {
  const bad = cloudRunService('staging-pool', 'latest', [
    { name: 'SPRING_DATASOURCE_HIKARI_JDBCURL', value: 'jdbc:postgresql://production.example/prod' },
  ]);
  const r = readers({ apiService: bad });
  await expectDenied('DATASOURCE_OVERRIDE_UNSUPPORTED', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
  }));
});

test('any unmodeled Flyway override is rejected', async () => {
  const r = readers({
    apiService: cloudRunService('staging-pool', 'latest', [{ name: 'SPRING_FLYWAY_URL', value: 'SENTINEL_SOURCE' }]),
  });
  await expectDenied('FLYWAY_OVERRIDE_UNSUPPORTED', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
  }));
});



test('ambiguous Spring override channels are rejected', async () => {
  const r = readers({
    apiService: cloudRunService('staging-pool', 'latest', [{ name: 'SPRING_APPLICATION_JSON', value: '{"spring":{"datasource":{"url":"SENTINEL_SOURCE"}}}' }]),
  });
  await expectDenied('SPRING_OVERRIDE_CHANNEL_UNSUPPORTED', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
  }));
});

test('container entrypoint arguments are rejected instead of loading unreviewed Spring configuration', async () => {
  const bad = cloudRunService('staging-pool');
  bad.spec.template.spec.containers[0].args = ['--spring.config.import=optional:file:/synthetic-override.yml'];
  const r = readers({ apiService: bad });
  await expectDenied('SERVICE_ENTRYPOINT_OVERRIDE_UNSUPPORTED', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
  }));
});

test('unexpected Spring profile is rejected', async () => {
  const bad = cloudRunService('staging-pool');
  bad.spec.template.spec.containers[0].env[0].value = 'other';
  const r = readers({ apiService: bad });
  await expectDenied('SPRING_PROFILE_MISMATCH', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
  }));
});

test('checked secret version mismatch is rejected before execution plan exists', async () => {
  const r = readers({ version: '8' });
  await expectDenied('DATASOURCE_SECRET_VERSION_MISMATCH', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
  }));
});

test('an observed numeric version different from policy is rejected', async () => {
  const r = readers({ apiService: cloudRunService('staging-pool', '9') });
  await expectDenied('DATASOURCE_SECRET_VERSION_MISMATCH', () => createPreflightPlan({
    policy: verifiedPolicy(), request: request(), ...r,
  }));
});

test('if either target fails, caller mutation executor is never reached', async () => {
  let mutations = 0;
  const r = readers({ workerService: cloudRunService('unknown-worker') });
  try {
    await createPreflightPlan({ policy: verifiedPolicy(), request: request(), ...r });
    mutations += 1;
  } catch (error) {
    assert.ok(error instanceof PreflightError);
  }
  assert.equal(mutations, 0);
});

test('paired canonical database mismatch never reaches the caller mutation executor', async () => {
  let mutations = 0;
  const r = readers();
  const policy = verifiedPolicy({
    aliases: [
      alias('staging-pool', 'neon:staging:api:codearchive:codearchive_v2', 'staging-pool'),
      alias('staging-direct', 'neon:staging:worker:codearchive:codearchive_v2', 'staging-direct'),
    ],
  });
  try {
    await createPreflightPlan({ policy, request: request(), ...r });
    mutations += 1;
  } catch (error) {
    assert.ok(error instanceof PreflightError);
    assert.equal(error.code, 'PAIRED_DATABASE_IDENTITY_MISMATCH');
  }
  assert.equal(mutations, 0);
});

test('plan fingerprint rejects checked-plan/execution-plan tampering', async () => {
  const r = readers();
  const plan = await createPreflightPlan({ policy: verifiedPolicy(), request: request(), ...r });
  plan.targets[0].datasourceSecrets.SPRING_DATASOURCE_URL.version = '8';
  assert.throws(() => renderBindings(plan, API), (error) => error instanceof PreflightError && error.code === 'PLAN_FINGERPRINT_MISMATCH');
});

test('provider stderr containing sentinel credentials/tokens/source is never re-emitted', async () => {
  const sentinel = 'SENTINEL_PASSWORD SENTINEL_TOKEN SENTINEL_SOURCE';
  const reader = makeGcloudReader({
    gcloudBin: 'fake-gcloud',
    spawn: () => ({ status: 1, stdout: '', stderr: sentinel }),
  });
  await assert.rejects(
    () => reader.loadService({ project: PROJECT, region: REGION, service: API }),
    (error) => {
      assert.ok(error instanceof PreflightError);
      assert.equal(error.code, 'PROVIDER_READ_FAILED');
      assert.doesNotMatch(error.message, /SENTINEL_/);
      return true;
    },
  );
});

test('provider secret version lookup is pinned to the requested project', async () => {
  const calls = [];
  const reader = makeGcloudReader({
    gcloudBin: 'fake-gcloud',
    spawn: (_bin, args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify({
          name: 'projects/synthetic-project/secrets/synthetic-url/versions/7',
          state: 'ENABLED',
        }),
        stderr: '',
      };
    },
  });

  assert.equal(await reader.resolveSecretVersion('synthetic-url', 'latest', PROJECT), '7');
  assert.deepEqual(calls, [[
    'secrets', 'versions', 'describe', 'latest',
    '--secret=synthetic-url',
    '--project=synthetic-project',
    '--format=json',
  ]]);
});

test('Windows PowerShell gcloud path with spaces uses argument-safe invocation', async () => {
  const calls = [];
  const gcloudBin = 'C:\\Program Files\\Google\\Cloud SDK\\bin\\gcloud.ps1';
  const reader = makeGcloudReader({
    gcloudBin,
    platform: 'win32',
    powershellBin: 'powershell.exe',
    spawn: (executable, args, options) => {
      calls.push({ executable, args, options });
      return {
        status: 0,
        stdout: JSON.stringify({
          name: 'projects/synthetic-project/secrets/synthetic-url/versions/7',
          state: 'ENABLED',
        }),
        stderr: '',
      };
    },
  });

  assert.equal(await reader.resolveSecretVersion('synthetic-url', 'latest', PROJECT), '7');
  assert.equal(calls[0].executable, 'powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 6), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', gcloudBin,
  ]);
  assert.equal(calls[0].options.shell, false);
});
