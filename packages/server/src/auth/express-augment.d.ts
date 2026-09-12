import type { AuthInfo } from '@modelcontextprotocol/server';

declare module 'express-serve-static-core' {
  interface Request {
    /** Verified bearer token details, attached by `bearerAuth`; read by the MCP transport as `ctx.http.authInfo`. */
    auth?: AuthInfo;
  }
}
