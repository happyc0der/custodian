# Custodian

**A household inventory and product-safety agent for Alexa+.**

Tell Alexa what you own — "I just bought a Graco 4Ever car seat" — and Custodian keeps watch: it cross-references CPSC, NHTSA and openFDA recall feeds continuously, tracks warranties and maintenance intervals (smoke-detector batteries, water filters, car-seat expiry), and answers *"Alexa, is anything in my house recalled?"* hands-free, with the recall notice and remedy rendered on Echo Show.

Built for the Alexa+ track of Amazon's **Build, Ship, Shape** hackathon as a self-hosted MCP server (spec 2025-11-25, Streamable HTTP, OAuth 2.1) with MCP Apps for the screen experience.

> Status: under construction. See [FRICTION_LOG.md](FRICTION_LOG.md) for the running developer-experience notes.

## Layout

```
packages/shared   zod schemas + types shared by server and UI
packages/server   MCP server, OAuth 2.1 authorization server, recall sources, sweeper
packages/ui       MCP Apps (Echo Show views) bundled to single HTML files
infra             AWS CDK (App Runner + DynamoDB)
scripts           smoke test, OAuth conformance, asset generation
addon-package     Alexa+ add-on manifest (addon.json)
```

## Quick start (local, no Alexa account needed)

```bash
npm install
cp .env.example .env
npm run dev          # MCP server on http://localhost:3001/mcp  (AUTH_MODE=dev)
npm run smoke        # scripted MCP client exercising every tool
```

## License

MIT
