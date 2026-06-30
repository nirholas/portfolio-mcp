// Spend policy: hard guardrails around send_transfer, the one value-moving tool.
//
// Caps are read once from the env at module load. The native-SOL cap is enforced
// in the signing lib so the limit can't be bypassed; the recipient allowlist and
// the explicit confirm:true requirement are enforced in the tool handler.
//
// Limits are conservative by default. An operator who wants larger spends sets
// the env var explicitly and thereby accepts the risk.

import { LAMPORTS_PER_SOL } from '@solana/web3.js';

function envRaw(key) {
	const v = process.env[key];
	return v !== undefined && String(v).trim() !== '' ? String(v).trim() : undefined;
}

function envNumber(key, fallback) {
	const raw = envRaw(key);
	if (raw === undefined) return fallback;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) {
		throw Object.assign(new Error(`${key} must be a non-negative number (got "${raw}")`), {
			code: 'bad_policy_config',
		});
	}
	return n;
}

function envBool(key, fallback) {
	const raw = envRaw(key);
	if (raw === undefined) return fallback;
	return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
}

// Max SOL that a single native transfer may move. Default 0.5 SOL — generous for
// testing, low enough to bound a leaked-key or prompt-injection blast radius.
export const MAX_SOL_PER_TX = envNumber('MAX_SOL_PER_TX', 0.5);

// Optional recipient allowlist. Comma-separated base58 pubkeys. When set, every
// send_transfer destination must be in the list.
export const RECIPIENT_ALLOWLIST = (() => {
	const raw = envRaw('RECIPIENT_ALLOWLIST');
	if (!raw) return null; // null = no allowlist configured (allow any valid pubkey)
	const set = new Set(
		raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean),
	);
	return set.size ? set : null;
})();

// send_transfer requires an explicit confirm:true unless the operator opts out.
export const REQUIRE_CONFIRM = envBool('REQUIRE_CONFIRM', true);

// Sane ceiling on the compute-unit price (micro-lamports).
export const MAX_PRIORITY_MICRO_LAMPORTS = envNumber('MAX_PRIORITY_MICRO_LAMPORTS', 50_000_000);

/**
 * Assert a SOL amount is within MAX_SOL_PER_TX. Throws `over_spend_cap` with a
 * clear message otherwise. Called inside the signing lib so every native send is
 * covered. Token (SPL) transfers don't pass through this — their amount is
 * denominated in an arbitrary token, not SOL — but they still face the confirm
 * gate and the recipient allowlist.
 * @param {number} sol
 * @param {string} [label]
 */
export function assertSolWithinCap(sol, label = 'transfer') {
	const n = Number(sol);
	if (!Number.isFinite(n) || n < 0) {
		throw Object.assign(new Error(`${label}: amount must be a non-negative number (got ${sol})`), {
			code: 'invalid_amount',
		});
	}
	if (n > MAX_SOL_PER_TX) {
		throw Object.assign(
			new Error(
				`${label}: ${n} SOL exceeds the per-tx spend cap of ${MAX_SOL_PER_TX} SOL. ` +
					'Raise MAX_SOL_PER_TX in the MCP server environment to allow larger spends.',
			),
			{ code: 'over_spend_cap' },
		);
	}
	return n;
}

/**
 * Enforce the recipient allowlist (if configured). Throws `recipient_not_allowed`.
 * @param {string} pubkey — destination base58
 * @param {string} [label]
 */
export function assertRecipientAllowed(pubkey, label = 'destination') {
	if (!RECIPIENT_ALLOWLIST) return; // no allowlist → any valid pubkey is fine
	if (!RECIPIENT_ALLOWLIST.has(String(pubkey))) {
		throw Object.assign(
			new Error(
				`${label} ${pubkey} is not in RECIPIENT_ALLOWLIST. ` +
					'Add it to the allowlist env var to permit transfers to this address.',
			),
			{ code: 'recipient_not_allowed' },
		);
	}
}

/**
 * Gate the transfer on an explicit confirm flag. Returns a refusal object (for
 * the handler to return directly) when confirmation is required but absent;
 * returns null when the action may proceed.
 * @param {boolean|undefined} confirm
 * @param {string} action — human-readable name of the irreversible action
 */
export function confirmationGate(confirm, action) {
	if (!REQUIRE_CONFIRM) return null;
	if (confirm === true) return null;
	return {
		ok: false,
		error: 'confirmation_required',
		message:
			`${action} is IRREVERSIBLE and broadcasts a real transaction on Solana mainnet. ` +
			'Re-issue the call with `confirm: true` to proceed. ' +
			'(Set REQUIRE_CONFIRM=0 on the MCP server to disable this prompt.)',
	};
}

/**
 * Clamp a compute-unit price to MAX_PRIORITY_MICRO_LAMPORTS.
 * @param {number} micros
 */
export function clampPriorityMicroLamports(micros) {
	const n = Math.floor(Number(micros));
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.min(n, MAX_PRIORITY_MICRO_LAMPORTS);
}
