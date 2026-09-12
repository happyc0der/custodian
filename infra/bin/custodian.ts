import { App } from 'aws-cdk-lib';
import { CustodianStack } from '../lib/custodian-stack.js';

const app = new App();
new CustodianStack(app, 'Custodian', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2' },
  // First deploy: leave unset; the stack output prints the App Runner URL.
  // Second deploy: `cdk deploy -c publicUrl=https://xxxx.us-west-2.awsapprunner.com` so the OAuth issuer is right.
  publicUrl: app.node.tryGetContext('publicUrl') as string | undefined,
  redirectUris: (app.node.tryGetContext('redirectUris') as string | undefined) ?? '',
  bedrockModel: (app.node.tryGetContext('bedrockModel') as string | undefined) ?? 'anthropic.claude-opus-5',
});
