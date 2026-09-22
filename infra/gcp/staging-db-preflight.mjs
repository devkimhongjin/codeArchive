import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DB_ENV = {
  url: 'SPRING_DATASOURCE_URL',
  username: 'SPRING_DATASOURCE_USERNAME',
  password: 'SPRING_DATASOURCE_PASSWORD',
};
const ALLOWED_DATASOURCE_ENV = new Set(Object.values(DB_ENV));

const REQUIRED_TARGET_ROLES = ['api', 'worker'];
const SAFE_ID = /^[A-Za-z0-9._:@/+-]+$/;
const NUMERIC_VERSION = /^[1-9][0-9]*$/;
const SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/;
const SECRET_ANNOTATION = 'run.googleapis.com/secrets';
const AMBIGUOUS_SPRING_ENV = new Set([
  'SPRING_APPLICATION_JSON',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'SPRING_CONFIG_LOCATION',
  'SPRING_CONFIG_ADDITIONAL_LOCATION',
  'SPRING_CONFIG_IMPORT',
  'SPRING_CONFIG_NAME',
  'SPRING_PROFILES_INCLUDE',
  'SPRING_PROFILES_DEFAULT',
]);

export class PreflightError extends Error {
  constructor(code, subject = '') {
    super(code);
    this.name = 'PreflightError';
    this.code = code;
    this.subject = safeSubject(subject);
  }
}

function safeSubject(value) {
  if (typeof value !== 'string' || !value || !SAFE_ID.test(value)) return '';
  return value.slice(0, 180);
}

function deny(code, subject = '') {
  throw new PreflightError(code, subject);
}

function requiredString(value, code, subject) {
  if (typeof value !== 'string' || value.trim() === '') deny(code, subject);
  return value.trim();
}

function normalizeVersion(value, code = 'INVALID_SECRET_VERSION') {
  const text = String(value ?? '').trim();
  if (!NUMERIC_VERSION.test(text)) deny(code);
  return text;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprintCore(core) {
  return createHash('sha256').update(stableJson(core)).digest('hex');
}

function findContainers(service) {
  return service?.spec?.template?.spec?.containers
    ?? service?.spec?.template?.containers
    ?? service?.template?.containers
    ?? [];
}

function parseSecretRef(envEntry, envName, serviceName) {
  if (!envEntry || envEntry.name !== envName) deny('DATASOURCE_BINDING_MISSING', serviceName);
  if ('value' in envEntry && envEntry.value != null && String(envEntry.value) !== '') {
    deny('PLAINTEXT_DATASOURCE_OVERRIDE', serviceName);
  }
  const ref = envEntry?.valueFrom?.secretKeyRef;
  const secret = requiredString(ref?.name, 'DATASOURCE_SECRET_UNRESOLVED', serviceName);
  const key = requiredString(ref?.key, 'DATASOURCE_SECRET_UNRESOLVED', serviceName);
  if (key !== 'latest' && !NUMERIC_VERSION.test(key)) {
    deny('DATASOURCE_SECRET_VERSION_UNSUPPORTED', serviceName);
  }
  return { secret, key };
}

function parseSecretMappings(service, serviceName) {
  const template = service?.spec?.template ?? service?.template ?? {};
  const annotations = template?.metadata?.annotations;
  if (annotations == null || !(SECRET_ANNOTATION in annotations)) return new Map();
  const raw = annotations[SECRET_ANNOTATION];
  if (typeof raw !== 'string' || raw.trim() === '') deny('SECRET_MAPPING_INVALID', serviceName);
  const mappings = new Map();
  for (const item of raw.split(',')) {
    const separator = item.indexOf(':');
    if (separator <= 0) deny('SECRET_MAPPING_INVALID', serviceName);
    const alias = item.slice(0, separator).trim();
    const resource = item.slice(separator + 1).trim();
    const match = resource.match(/^projects\/([A-Za-z0-9-]+)\/secrets\/([A-Za-z0-9_-]+)$/);
    if (!SECRET_NAME.test(alias) || !match || mappings.has(alias)) {
      deny('SECRET_MAPPING_INVALID', serviceName);
    }
    mappings.set(alias, { project: match[1], secret: match[2] });
  }
  return mappings;
}

function resolveEffectiveSecret(ref, mappings, project, serviceName) {
  if (!SECRET_NAME.test(ref.secret)) deny('DATASOURCE_SECRET_NAME_INVALID', serviceName);
  const mapped = mappings.get(ref.secret);
  return {
    ...ref,
    effectiveProject: mapped?.project ?? project,
    effectiveSecret: mapped?.secret ?? ref.secret,
  };
}

export function inspectServiceDatasource(service, serviceName, expectedSpringProfile, project) {
  const containers = findContainers(service);
  if (!Array.isArray(containers) || containers.length !== 1) {
    deny('SERVICE_CONTAINER_LAYOUT_UNSUPPORTED', serviceName);
  }
  const container = containers[0];
  const env = Array.isArray(container?.env) ? container.env : [];
  const seenSpringEnv = new Set();
  for (const entry of env) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    if ((name.startsWith('SPRING_') || AMBIGUOUS_SPRING_ENV.has(name)) && seenSpringEnv.has(name)) {
      deny('SPRING_ENV_DUPLICATED', serviceName);
    }
    if (name.startsWith('SPRING_') || AMBIGUOUS_SPRING_ENV.has(name)) seenSpringEnv.add(name);
  }
  const flywayOverride = env.find((entry) => typeof entry?.name === 'string' && entry.name.startsWith('SPRING_FLYWAY_'));
  if (flywayOverride) deny('FLYWAY_OVERRIDE_UNSUPPORTED', serviceName);
  const datasourceOverride = env.find((entry) => typeof entry?.name === 'string'
    && entry.name.startsWith('SPRING_DATASOURCE_')
    && !ALLOWED_DATASOURCE_ENV.has(entry.name));
  if (datasourceOverride) deny('DATASOURCE_OVERRIDE_UNSUPPORTED', serviceName);
  const ambiguousOverride = env.find((entry) => typeof entry?.name === 'string' && AMBIGUOUS_SPRING_ENV.has(entry.name));
  if (ambiguousOverride) deny('SPRING_OVERRIDE_CHANNEL_UNSUPPORTED', serviceName);

  if (container?.command != null
      && (!Array.isArray(container.command) || container.command.length > 0)) {
    deny('SERVICE_ENTRYPOINT_OVERRIDE_UNSUPPORTED', serviceName);
  }
  if (container?.args != null && (!Array.isArray(container.args) || container.args.length > 0)) {
    deny('SERVICE_ENTRYPOINT_OVERRIDE_UNSUPPORTED', serviceName);
  }

  const byName = new Map(env.filter((entry) => typeof entry?.name === 'string').map((entry) => [entry.name, entry]));
  const profileEntry = byName.get('SPRING_PROFILES_ACTIVE');
  if (!profileEntry || typeof profileEntry.value !== 'string' || profileEntry.value.trim() !== expectedSpringProfile) {
    deny('SPRING_PROFILE_MISMATCH', serviceName);
  }

  const mappings = parseSecretMappings(service, serviceName);
  return Object.fromEntries(Object.entries(DB_ENV).map(([part, envName]) => [
    part,
    resolveEffectiveSecret(parseSecretRef(byName.get(envName), envName, serviceName), mappings, project, serviceName),
  ]));
}

function validatePolicyShape(policy, nowIso) {
  if (!policy || typeof policy !== 'object' || policy.schemaVersion !== 1) deny('POLICY_SCHEMA_UNSUPPORTED');
  if (policy.inventoryStatus !== 'verified') deny('POLICY_INVENTORY_UNVERIFIED');
  const reviewedAt = requiredString(policy.reviewedAt, 'POLICY_REVIEW_MISSING');
  const validUntil = requiredString(policy.validUntil, 'POLICY_EXPIRY_MISSING');
  const reviewedMs = Date.parse(reviewedAt);
  const validUntilMs = Date.parse(validUntil);
  const nowMs = Date.parse(nowIso);
  if (![reviewedMs, validUntilMs, nowMs].every(Number.isFinite) || reviewedMs > nowMs || validUntilMs <= reviewedMs) {
    deny('POLICY_TIME_INVALID');
  }
  if (nowMs >= validUntilMs) deny('POLICY_INVENTORY_EXPIRED');
  if (!Array.isArray(policy.services) || policy.services.length === 0
      || !Array.isArray(policy.datasourceAliases) || policy.datasourceAliases.length === 0
      || !Array.isArray(policy.approvedNonproductionDatabases) || policy.approvedNonproductionDatabases.length === 0
      || !Array.isArray(policy.protectedProductionDatabases) || policy.protectedProductionDatabases.length === 0) {
    deny('POLICY_INVENTORY_INCOMPLETE');
  }
}

function serviceKey(project, region, service) {
  return `${project}/${region}/${service}`;
}

function findPolicyService(policy, project, region, service) {
  const matches = policy.services.filter((entry) =>
    entry?.project === project && entry?.region === region && entry?.service === service);
  if (matches.length !== 1) deny('SERVICE_NOT_REGISTERED', service);
  const entry = matches[0];
  requiredString(entry.evidence, 'SERVICE_EVIDENCE_MISSING', service);
  if (entry.role !== 'nonproduction' && entry.role !== 'production') deny('SERVICE_ROLE_INVALID', service);
  if (entry.role === 'production') deny('PRODUCTION_SERVICE_BLOCKED', service);
  requiredString(entry.datasourceAlias, 'SERVICE_DATASOURCE_ALIAS_MISSING', service);
  requiredString(entry.springProfile, 'SERVICE_SPRING_PROFILE_MISSING', service);
  return entry;
}

function findAlias(policy, aliasName, serviceName) {
  const matches = policy.datasourceAliases.filter((entry) => entry?.alias === aliasName);
  if (matches.length !== 1) deny('DATASOURCE_ALIAS_NOT_REGISTERED', serviceName);
  const alias = matches[0];
  requiredString(alias.evidence, 'DATASOURCE_EVIDENCE_MISSING', aliasName);
  requiredString(alias.canonicalDatabaseId, 'CANONICAL_DATABASE_ID_MISSING', aliasName);
  const refs = alias.secretVersions;
  if (!refs || typeof refs !== 'object') deny('DATASOURCE_SECRET_INVENTORY_MISSING', aliasName);
  for (const part of ['url', 'username', 'password']) {
    const item = refs[part];
    requiredString(item?.name, 'DATASOURCE_SECRET_INVENTORY_MISSING', `${aliasName}:${part}`);
    if (!SECRET_NAME.test(item.name)) deny('DATASOURCE_SECRET_NAME_INVALID', `${aliasName}:${part}`);
    normalizeVersion(item?.version, 'DATASOURCE_SECRET_VERSION_INVALID');
  }
  return alias;
}

function assertApprovedNonproductionDatabase(policy, canonicalId, serviceName) {
  const matches = policy.approvedNonproductionDatabases.filter((entry) => entry?.canonicalDatabaseId === canonicalId);
  if (matches.length !== 1) deny('NONPRODUCTION_DATABASE_NOT_REGISTERED', serviceName);
  requiredString(matches[0].evidence, 'NONPRODUCTION_DATABASE_EVIDENCE_MISSING', serviceName);
}

function canonicalIsProtected(policy, canonicalId) {
  return policy.protectedProductionDatabases.includes(canonicalId);
}

async function verifyObservedBinding({ project, serviceName, observed, alias, resolveSecretVersion }) {
  const execution = {};
  for (const part of ['url', 'username', 'password']) {
    const observedRef = observed[part];
    const approved = alias.secretVersions[part];
    if (observedRef.effectiveProject !== project) deny('DATASOURCE_SECRET_PROJECT_MISMATCH', serviceName);
    if (observedRef.effectiveSecret !== approved.name) deny('DATASOURCE_SECRET_ALIAS_MISMATCH', `${serviceName}:${part}`);

    const approvedVersion = normalizeVersion(approved.version);
    const resolvedVersion = normalizeVersion(
      await resolveSecretVersion(approved.name, observedRef.key, project),
      'PROVIDER_SECRET_VERSION_INVALID',
    );
    if (resolvedVersion !== approvedVersion) deny('DATASOURCE_SECRET_VERSION_MISMATCH', `${serviceName}:${part}`);

    execution[DB_ENV[part]] = {
      secret: approved.name,
      version: approvedVersion,
    };
  }
  return execution;
}

export async function createPreflightPlan({ policy, request, loadService, resolveSecretVersion, now = () => new Date().toISOString() }) {
  const generatedAt = now();
  validatePolicyShape(policy, generatedAt);
  const project = requiredString(request?.project, 'TARGET_PROJECT_MISSING');
  const region = requiredString(request?.region, 'TARGET_REGION_MISSING');
  const targets = request?.targets;
  if (!Array.isArray(targets) || targets.length !== REQUIRED_TARGET_ROLES.length) deny('TARGET_SET_INVALID');
  const roleSet = new Set(targets.map((target) => target?.targetRole));
  if (roleSet.size !== REQUIRED_TARGET_ROLES.length || REQUIRED_TARGET_ROLES.some((role) => !roleSet.has(role))) deny('TARGET_SET_INVALID');

  const seenServices = new Set();
  const planTargets = [];
  for (const targetRole of REQUIRED_TARGET_ROLES) {
    const target = targets.find((item) => item.targetRole === targetRole);
    const service = requiredString(target?.service, 'TARGET_SERVICE_MISSING', targetRole);
    if (seenServices.has(service)) deny('TARGET_SERVICE_DUPLICATED', service);
    seenServices.add(service);

    const policyService = findPolicyService(policy, project, region, service);
    const alias = findAlias(policy, policyService.datasourceAlias, service);
    if (canonicalIsProtected(policy, alias.canonicalDatabaseId)) deny('PRODUCTION_DATABASE_BLOCKED', service);
    assertApprovedNonproductionDatabase(policy, alias.canonicalDatabaseId, service);

    const observedService = await loadService({ project, region, service });
    const observed = inspectServiceDatasource(observedService, service, policyService.springProfile, project);
    const executionSecrets = await verifyObservedBinding({
      project,
      serviceName: service,
      observed,
      alias,
      resolveSecretVersion,
    });

    planTargets.push({
      targetRole,
      service,
      serviceKey: serviceKey(project, region, service),
      datasourceAlias: alias.alias,
      canonicalDatabaseId: alias.canonicalDatabaseId,
      datasourceSecrets: executionSecrets,
    });
  }

  const canonicalDatabaseIds = new Set(planTargets.map((target) => target.canonicalDatabaseId));
  if (canonicalDatabaseIds.size !== 1) deny('PAIRED_DATABASE_IDENTITY_MISMATCH');

  const core = {
    schemaVersion: 1,
    project,
    region,
    targets: planTargets,
  };
  return {
    ...core,
    generatedAt,
    fingerprint: fingerprintCore(core),
  };
}

export function verifyPlanFingerprint(plan) {
  if (!plan || plan.schemaVersion !== 1 || !Array.isArray(plan.targets)) deny('PLAN_SCHEMA_INVALID');
  const core = {
    schemaVersion: plan.schemaVersion,
    project: plan.project,
    region: plan.region,
    targets: plan.targets,
  };
  const expected = fingerprintCore(core);
  if (plan.fingerprint !== expected) deny('PLAN_FINGERPRINT_MISMATCH');
  return expected;
}

export function renderBindings(plan, service) {
  verifyPlanFingerprint(plan);
  const target = plan.targets.find((item) => item.service === service);
  if (!target) deny('PLAN_SERVICE_MISSING', service);
  const parts = [];
  for (const envName of [DB_ENV.url, DB_ENV.username, DB_ENV.password]) {
    const binding = target.datasourceSecrets?.[envName];
    const secret = requiredString(binding?.secret, 'PLAN_BINDING_INVALID', service);
    const version = normalizeVersion(binding?.version, 'PLAN_BINDING_INVALID');
    parts.push(`${envName}=${secret}:${version}`);
  }
  return parts.join(',');
}

export function makeGcloudReader({
  gcloudBin = 'gcloud',
  spawn = spawnSync,
  platform = process.platform,
  powershellBin = 'powershell.exe',
} = {}) {
  const invoke = (args, subject) => {
    const isPowerShellScript = platform === 'win32' && /\.ps1$/i.test(gcloudBin);
    const executable = isPowerShellScript ? powershellBin : gcloudBin;
    const executableArgs = isPowerShellScript
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', gcloudBin, ...args]
      : args;
    const result = spawn(executable, executableArgs, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      shell: false,
    });
    if (result?.error || result?.status !== 0) deny('PROVIDER_READ_FAILED', subject);
    return String(result.stdout ?? '').trim();
  };

  return {
    async loadService({ project, region, service }) {
      const raw = invoke([
        'run', 'services', 'describe', service,
        `--project=${project}`,
        `--region=${region}`,
        '--format=json',
      ], service);
      try {
        return JSON.parse(raw);
      } catch {
        deny('PROVIDER_SERVICE_RESPONSE_INVALID', service);
      }
    },

    async resolveSecretVersion(secret, reference = 'latest', project) {
      if (reference !== 'latest' && !NUMERIC_VERSION.test(reference)) deny('PROVIDER_SECRET_VERSION_INVALID', secret);
      const targetProject = requiredString(project, 'TARGET_PROJECT_MISSING');
      const raw = invoke([
        'secrets', 'versions', 'describe', reference,
        `--secret=${secret}`,
        `--project=${targetProject}`,
        '--format=json',
      ], secret);
      let metadata;
      try {
        metadata = JSON.parse(raw);
      } catch {
        deny('PROVIDER_SECRET_VERSION_INVALID', secret);
      }
      if (metadata?.state !== 'ENABLED') deny('PROVIDER_SECRET_VERSION_NOT_ENABLED', secret);
      const name = String(metadata?.name ?? '');
      const match = name.match(/(?:^|\/versions\/)([1-9][0-9]*)$/);
      if (!match) deny('PROVIDER_SECRET_VERSION_INVALID', secret);
      return match[1];
    },
  };
}

function parseArgs(argv) {
  if (argv.length === 0) deny('CLI_COMMAND_MISSING');
  const command = argv[0];
  const values = new Map();
  for (let i = 1; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) deny('CLI_ARGUMENT_INVALID');
    values.set(key.slice(2), argv[i + 1]);
    i += 1;
  }
  return { command, values };
}

function arg(values, name, required = true) {
  const value = values.get(name);
  if (required && (!value || value.trim() === '')) deny('CLI_ARGUMENT_MISSING', name);
  return value;
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    deny(code);
  }
}

async function prepare(values) {
  const policyPath = arg(values, 'policy');
  const outPath = arg(values, 'out');
  const project = arg(values, 'project');
  const region = arg(values, 'region');
  const apiService = arg(values, 'api-service');
  const workerService = arg(values, 'worker-service');
  const gcloudBin = arg(values, 'gcloud-bin', false) ?? 'gcloud';

  const policy = await readJson(policyPath, 'POLICY_READ_FAILED');
  const reader = makeGcloudReader({ gcloudBin });
  const plan = await createPreflightPlan({
    policy,
    request: {
      project,
      region,
      targets: [
        { targetRole: 'api', service: apiService },
        { targetRole: 'worker', service: workerService },
      ],
    },
    loadService: reader.loadService,
    resolveSecretVersion: reader.resolveSecretVersion,
  });

  await writeFile(outPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`PREFLIGHT_OK ${plan.fingerprint}\n`);
}

async function bindings(values) {
  const planPath = arg(values, 'plan');
  const service = arg(values, 'service');
  const plan = await readJson(planPath, 'PLAN_READ_FAILED');
  process.stdout.write(`${renderBindings(plan, service)}\n`);
}

async function fingerprint(values) {
  const planPath = arg(values, 'plan');
  const plan = await readJson(planPath, 'PLAN_READ_FAILED');
  process.stdout.write(`${verifyPlanFingerprint(plan)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { command, values } = parseArgs(argv);
    if (command === 'prepare') await prepare(values);
    else if (command === 'bindings') await bindings(values);
    else if (command === 'fingerprint') await fingerprint(values);
    else deny('CLI_COMMAND_INVALID', command);
    return 0;
  } catch (error) {
    if (error instanceof PreflightError) {
      const suffix = error.subject ? ` ${error.subject}` : '';
      process.stderr.write(`STAGING_DB_PREFLIGHT_DENY ${error.code}${suffix}\n`);
      return 2;
    }
    process.stderr.write('STAGING_DB_PREFLIGHT_DENY INTERNAL_ERROR\n');
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
