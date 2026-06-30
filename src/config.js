// Centralized env + HTTP base for the portfolio MCP.
//
// This server has two surfaces:
//   • HTTP reads against the live three.ws API (THREE_WS_BASE) — the public
//     trade feed and the account-scoped portfolio analytics.
//   • Direct Solana RPC (SOLANA_RPC_URL) for live on-chain balance reads and the
//     one write tool, send_transfer, which signs locally with SOLANA_SECRET_KEY.
//
// Account-scoped reads (summary/history/asset) operate on the agents YOU own, so
// they authenticate with your three.ws session token (THREE_WS_SESSION) — the
// same `__Host-sid` cookie a signed-in browser carries. We never hold a baked-in
// key: signing requires SOLANA_SECRET_KEY (or a per-call secret) that you supply.

export function env(key, fallback) {
	const v = process.env[key];
	return v !== undefined && String(v).trim() !== '' ? String(v).trim() : fallback;
}

// Base URL of the three.ws API. Override only when self-hosting or pointing at a
// preview deployment.
export const THREE_WS_BASE = env('THREE_WS_BASE', 'https://three.ws').replace(/\/+$/, '');

// Per-request timeout (ms). These are live reads (balance fan-outs, snapshot
// history) — generous enough to ride out a cold edge, fast in practice.
export const HTTP_TIMEOUT_MS = (() => {
	const raw = env('THREE_WS_TIMEOUT_MS');
	if (raw === undefined) return 20000;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) {
		throw Object.assign(new Error(`THREE_WS_TIMEOUT_MS must be a positive number (got "${raw}")`), {
			code: 'bad_config',
		});
	}
	return n;
})();

// Session token for the account-scoped portfolio reads. This is the value of the
// `__Host-sid` cookie from a signed-in three.ws browser session; the API reads it
// to resolve the calling user and return only the agents they own. Empty for the
// public surfaces (trade feed, on-chain balance reads).
export const THREE_WS_SESSION = env('THREE_WS_SESSION', '');

// Solana RPC used by get_wallet_balances and send_transfer. We sign and broadcast
// real mainnet transactions over this URL, so reject a plaintext-http endpoint
// outside of localhost — it's a credential/MITM risk.
function validateRpcUrl(raw) {
	let u;
	try {
		u = new URL(raw);
	} catch {
		throw Object.assign(new Error(`SOLANA_RPC_URL is not a valid URL: "${raw}"`), { code: 'bad_rpc_url' });
	}
	if (u.protocol === 'https:') return raw;
	const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(u.hostname);
	if (u.protocol === 'http:' && isLocal) return raw;
	throw Object.assign(
		new Error(
			`SOLANA_RPC_URL must be https (got "${u.protocol}//${u.hostname}"). ` +
				'Only http://localhost is allowed for local dev validators.',
		),
		{ code: 'insecure_rpc_url' },
	);
}

export const SOLANA_RPC_URL = validateRpcUrl(env('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'));

// Default signer for send_transfer. The per-call `secret` arg overrides this.
export const SOLANA_DEFAULT_SECRET = env('SOLANA_SECRET_KEY', '');

// Identifies this client to the API in request logs.
export const USER_AGENT = '@three-ws/portfolio-mcp';
