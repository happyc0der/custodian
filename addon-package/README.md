# Alexa+ add-on package

`addon.json` is the manifest `alexa-ai deploy` submits. Two things are environment-specific:

1. Replace `REPLACE-WITH-SERVICE-URL` with the public HTTPS origin of the server
   (the `ServiceUrl` output of `cdk deploy`, or a `cloudflared` tunnel during development).
2. Regenerate media with `npm run gen:assets` (writes `assets/generated/`).

Then, from the repo root:

```bash
alexa-ai new mcp --name "Custodian" --locale en-US --mcp-server-url "https://<host>/mcp"   # first time only; then merge this addon.json
alexa-ai configure-account-linking --addon-id <id> --stage development --client-id alexa     # secret via ALEXA_CLIENT_SECRET / prompt
alexa-ai deploy
addon-local-inspector https://<host>/mcp        # certification-readiness report
alexa-ai submit
```

The exact key names in `addon.json` follow the Alexa+ MCP QuickStart; if `alexa-ai new mcp`
scaffolds a newer schema, keep its skeleton and copy the listing text, phrases and media paths from here.
