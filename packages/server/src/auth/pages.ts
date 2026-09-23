/** Server-rendered HTML for the login/consent page and the policy pages. No external assets (works on any device webview). */

const CSS = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#14171a;--muted:#5b6470;--accent:#0f6fff;--border:#dfe3e8;--danger:#b42318}
@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a20;--fg:#f2f4f7;--muted:#9aa4b2;--accent:#5ea0ff;--border:#2a2f38;--danger:#ff8c82}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:460px;margin:8vh auto;padding:0 20px}.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px}
h1{font-size:22px;margin:0 0 4px}p{margin:8px 0;color:var(--muted)}label{display:block;font-weight:600;margin:18px 0 6px}
input{width:100%;font:inherit;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--fg)}
button{width:100%;margin-top:22px;padding:14px;font:inherit;font-weight:700;border:0;border-radius:10px;background:var(--accent);color:#fff;cursor:pointer}
.err{color:var(--danger);font-weight:600}.scopes{margin:14px 0 0;padding-left:18px;color:var(--muted)}.brand{display:flex;gap:10px;align-items:center;margin-bottom:14px}
.logo{width:36px;height:36px;border-radius:10px;background:var(--accent);display:grid;place-items:center;color:#fff;font-weight:800}small{color:var(--muted)}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const SCOPE_TEXT: Record<string, string> = {
  'mcp:tools': 'Add, list and check the things your household owns',
  'mcp:resources': 'Read your household summary',
  'mcp:service': 'Discover available features',
};

export function loginPage(opts: {
  requestId: string;
  clientName: string;
  scopes: string[];
  error?: string;
  household?: string;
}): string {
  const scopeItems = opts.scopes.map((s) => `<li>${escapeHtml(SCOPE_TEXT[s] ?? s)}</li>`).join('');
  return page(
    'Link Custodian',
    `<div class="card">
      <div class="brand"><div class="logo">C</div><div><strong>Custodian</strong><br><small>Household recall &amp; maintenance watch</small></div></div>
      <h1>Link your household</h1>
      <p><strong>${escapeHtml(opts.clientName)}</strong> is asking to:</p>
      <ul class="scopes">${scopeItems}</ul>
      ${opts.error ? `<p class="err">${escapeHtml(opts.error)}</p>` : ''}
      <form method="post" action="/authorize" autocomplete="on">
        <input type="hidden" name="request_id" value="${escapeHtml(opts.requestId)}">
        <label for="household">Household name</label>
        <input id="household" name="household" required minlength="2" maxlength="60" placeholder="e.g. The Rajput home" value="${escapeHtml(opts.household ?? '')}" autocapitalize="words">
        <label for="passphrase">Passphrase</label>
        <input id="passphrase" name="passphrase" type="password" required minlength="6" maxlength="200" autocomplete="current-password">
        <p><small>New household? Choose a name and passphrase and it will be created. Everyone in your home shares them.</small></p>
        <button type="submit">Link household</button>
      </form>
    </div>`,
  );
}

export function messagePage(title: string, text: string): string {
  return page(
    title,
    `<div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></div>`,
  );
}

export function privacyPage(publicUrl: string): string {
  return page(
    'Custodian privacy policy',
    `<div class="card"><h1>Privacy policy</h1>
    <p>Custodian stores the inventory you tell it about (product names, brands, models, purchase dates, vehicle make/model/year) and the reminders and recall matches derived from it, keyed to your household. Nothing else is collected.</p>
    <p>Recall data comes from public U.S. government feeds (CPSC, NHTSA, FDA). Your inventory is never sent to those services except as short search terms needed to look up recalls for an item.</p>
    <p>Data is kept until you remove an item or ask for the household to be deleted. It is not sold or shared with third parties.</p>
    <p>Alexa+ access is granted through OAuth 2.1 and can be revoked at any time by unlinking Custodian in the Alexa app.</p>
    <p><small>Service: ${escapeHtml(publicUrl)} · Open source: github.com/happyc0der/custodian</small></p></div>`,
  );
}

export function termsPage(publicUrl: string): string {
  return page(
    'Custodian terms of use',
    `<div class="card"><h1>Terms of use</h1>
    <p>Custodian is provided as-is, without warranty. Recall information is sourced from public feeds and may be incomplete, delayed or inaccurate; always confirm with the manufacturer or the issuing agency before acting.</p>
    <p>Maintenance reminders are general guidance, not a substitute for the manufacturer's instructions or a professional inspection.</p>
    <p>By linking your household you agree to use the service lawfully and only for households you are part of.</p>
    <p><small>Service: ${escapeHtml(publicUrl)}</small></p></div>`,
  );
}
