// Exchanges the GitHub Actions OIDC token for a short-lived Visual Studio Marketplace
// credential (Trusted Publishing) and exports it as MARKETPLACE_TOKEN for the next steps.
// Requires `permissions: id-token: write`. The credential expires after 15 minutes and each
// OIDC token can be exchanged only once, so run this right before publishing.
// Usage: node .github/scripts/marketplace-token.mjs <publisher>
import { appendFileSync } from 'node:fs';

const publisher = process.argv[2];
if (!publisher) {
  console.error('Usage: marketplace-token.mjs <publisher>');
  process.exit(1);
}

const { ACTIONS_ID_TOKEN_REQUEST_URL: requestUrl, ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken, GITHUB_ENV } = process.env;
if (!requestUrl || !requestToken || !GITHUB_ENV) {
  console.error('Not running in GitHub Actions with `permissions: id-token: write`.');
  process.exit(1);
}

const marketplace = 'https://marketplace.visualstudio.com';

async function json(label, url, init) {
  const res = await fetch(url, init);
  const body = await res.text();
  if (!res.ok) throw new Error(`${label} failed: ${res.status} ${res.statusText}\n${body}`);
  return JSON.parse(body);
}

const tokenUrl = new URL(requestUrl);
tokenUrl.searchParams.set('audience', 'marketplace.visualstudio.com');
const { value: oidcToken } = await json('GitHub OIDC token request', tokenUrl, {
  headers: { Accept: 'application/json', Authorization: `Bearer ${requestToken}` },
});
if (!oidcToken) throw new Error('GitHub returned an empty OIDC token');

const { credential } = await json(
  'Marketplace token exchange',
  `${marketplace}/_apis/gallery/token?api-version=7.2-preview.1`,
  {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `FederatedToken ${oidcToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ publisherName: publisher }),
  },
);
if (!credential) throw new Error('Marketplace returned an empty credential');

console.log(`::add-mask::${credential}`);
appendFileSync(GITHUB_ENV, `MARKETPLACE_TOKEN=${credential}\n`);
console.log(`Obtained a Marketplace credential for publisher "${publisher}".`);
