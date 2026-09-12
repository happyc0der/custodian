import 'dotenv/config';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export interface Config {
  port: number;
  publicUrl: string;
  store: 'file' | 'dynamo';
  fileStorePath: string;
  dynamoTable: string;
  awsRegion: string;
  authMode: 'dev' | 'oauth';
  devBearerToken: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRedirectUris: string[];
  jwtPrivateKey: string | undefined;
  sweepCron: string;
  sweepOnBoot: boolean;
  bedrockEnabled: boolean;
  bedrockRegion: string;
  bedrockModel: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const publicUrl = env('PUBLIC_URL', 'http://localhost:3001').replace(/\/+$/, '');
  return {
    port: Number(env('PORT', '3001')),
    publicUrl,
    store: env('STORE', 'file') === 'dynamo' ? 'dynamo' : 'file',
    fileStorePath: env('FILE_STORE_PATH', './data/store.json'),
    dynamoTable: env('DYNAMO_TABLE', 'custodian'),
    awsRegion: env('AWS_REGION', 'us-west-2'),
    authMode: env('AUTH_MODE', 'dev') === 'oauth' ? 'oauth' : 'dev',
    devBearerToken: env('DEV_BEARER_TOKEN', 'dev-token'),
    oauthClientId: env('OAUTH_CLIENT_ID', 'alexa'),
    oauthClientSecret: env('OAUTH_CLIENT_SECRET', 'change-me'),
    oauthRedirectUris: env('OAUTH_REDIRECT_URIS', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    jwtPrivateKey: process.env.JWT_PRIVATE_KEY || undefined,
    sweepCron: env('SWEEP_CRON', '0 * * * *'),
    sweepOnBoot: bool('SWEEP_ON_BOOT', true),
    bedrockEnabled: bool('BEDROCK_ENABLED', false),
    bedrockRegion: env('BEDROCK_REGION', 'us-west-2'),
    bedrockModel: env('BEDROCK_MODEL', 'anthropic.claude-opus-5'),
    ...overrides,
  };
}
