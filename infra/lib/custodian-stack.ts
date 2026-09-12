import * as apprunner from '@aws-cdk/aws-apprunner-alpha';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface CustodianStackProps extends StackProps {
  /** Public HTTPS origin (App Runner default domain or a custom one). Unset on the first deploy. */
  publicUrl?: string;
  /** Comma-separated Alexa account-linking redirect URIs. */
  redirectUris: string;
  bedrockModel: string;
}

/**
 * Custodian on AWS: one App Runner service (Fargate-backed, HTTPS out of the
 * box) running the MCP server + OAuth AS + sweeper, a single DynamoDB table,
 * a generated OAuth client secret in Secrets Manager, and Bedrock access for
 * enrichment. Deliberately small: a hackathon judge should be able to read it.
 */
export class CustodianStack extends Stack {
  constructor(scope: Construct, id: string, props: CustodianStackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // The confidential client Alexa+ uses at /token. `alexa-ai configure-account-linking` reads the same value.
    const oauthSecret = new secrets.Secret(this, 'OAuthClientSecret', {
      description: 'Custodian OAuth client secret for Alexa+ account linking',
      generateSecretString: { excludePunctuation: true, passwordLength: 48 },
    });

    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const image = new ecrAssets.DockerImageAsset(this, 'Image', {
      directory: repoRoot,
      platform: ecrAssets.Platform.LINUX_AMD64,
      exclude: ['node_modules', '**/node_modules', '**/dist', '**/cdk.out', '.git', 'data', '**/data', '*.log', '.env'],
    });

    const instanceRole = new iam.Role(this, 'InstanceRole', { assumedBy: new iam.ServicePrincipal('tasks.apprunner.amazonaws.com') });
    table.grantReadWriteData(instanceRole);
    oauthSecret.grantRead(instanceRole);
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [`arn:aws:bedrock:*::foundation-model/*`, `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`],
      }),
    );

    const service = new apprunner.Service(this, 'Service', {
      serviceName: 'custodian',
      source: apprunner.Source.fromAsset({
        asset: image,
        imageConfiguration: {
          port: 3001,
          environmentVariables: {
            NODE_ENV: 'production',
            PORT: '3001',
            STORE: 'dynamo',
            DYNAMO_TABLE: table.tableName,
            AWS_REGION: this.region,
            AUTH_MODE: 'oauth',
            OAUTH_CLIENT_ID: 'alexa',
            OAUTH_REDIRECT_URIS: props.redirectUris,
            BEDROCK_ENABLED: 'true',
            BEDROCK_REGION: this.region,
            BEDROCK_MODEL: props.bedrockModel,
            SWEEP_CRON: '0 * * * *',
            SWEEP_ON_BOOT: 'true',
            UI_DIST: '/app/packages/ui/dist',
            ...(props.publicUrl ? { PUBLIC_URL: props.publicUrl } : {}),
          },
          environmentSecrets: {
            OAUTH_CLIENT_SECRET: apprunner.Secret.fromSecretsManager(oauthSecret),
          },
        },
      }),
      instanceRole,
      cpu: apprunner.Cpu.HALF_VCPU,
      memory: apprunner.Memory.ONE_GB,
      healthCheck: apprunner.HealthCheck.http({ path: '/healthz', interval: Duration.seconds(10), timeout: Duration.seconds(5), healthyThreshold: 1, unhealthyThreshold: 5 }),
      // One always-on instance keeps the hourly sweep running; App Runner scales up under load.
      autoScalingConfiguration: new apprunner.AutoScalingConfiguration(this, 'Scaling', { minSize: 1, maxSize: 3, maxConcurrency: 100 }),
    });

    new CfnOutput(this, 'ServiceUrl', { value: `https://${service.serviceUrl}`, description: 'Set as PUBLIC_URL (cdk deploy -c publicUrl=…) and as the add-on MCP endpoint (+/mcp)' });
    new CfnOutput(this, 'McpEndpoint', { value: `https://${service.serviceUrl}/mcp` });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'OAuthClientSecretArn', { value: oauthSecret.secretArn, description: 'aws secretsmanager get-secret-value --secret-id <arn> for alexa-ai configure-account-linking' });
  }
}
