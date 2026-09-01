const CURSEFORGE_BASE_URL = "https://api.curseforge.com";
const CURSEFORGE_MINECRAFT_GAME_ID = 432;
const SAFE_VERSION = /^[A-Za-z0-9.-]{1,64}$/;
const MAX_FINGERPRINTS = 100;
class HttpError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code
	}
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			...extraHeaders
		}
	})
}

function errorResponse(error, corsHeaders) {
	if (error instanceof HttpError) {
		return jsonResponse({
			error: {
				code: error.code,
				message: error.message
			}
		}, error.status, corsHeaders)
	}
	return jsonResponse({
		error: {
			code: "internal_error",
			message: "Internal server error"
		}
	}, 500, corsHeaders)
}

function buildCorsHeaders(request, env) {
	const origin = request.headers.get("Origin");
	if (!origin) {
		return {
			Vary: "Origin"
		}
	}
	if (!env.ALLOWED_ORIGIN) {
		return {
			Vary: "Origin"
		}
	}
	if (origin !== env.ALLOWED_ORIGIN) {
		return {
			Vary: "Origin"
		}
	}
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin"
	}
}

function handleOptions(request, env) {
	const corsHeaders = buildCorsHeaders(request, env);
	const origin = request.headers.get("Origin");
	if (origin && env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) {
		return new Response(null, {
			status: 403,
			headers: corsHeaders
		})
	}
	return new Response(null, {
		status: 204,
		headers: corsHeaders
	})
}

function assertCorsAllowed(request, env) {
	const origin = request.headers.get("Origin");
	if (!origin) return;
	if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) {
		throw new HttpError(403, "origin_forbidden", "Origin is not allowed")
	}
}

function requireSecret(env) {
	if (typeof env.CURSEFORGE_API_KEY !== "string" || env.CURSEFORGE_API_KEY.length === 0) {
		throw new HttpError(500, "missing_secret", "Server is missing CurseForge API configuration")
	}
	return env.CURSEFORGE_API_KEY
}


function parseGameVersion(value) {
	if (value === null) {
		throw new HttpError(400, "missing_parameter", "gameVersion is required")
	}
	if (!SAFE_VERSION.test(value)) {
		throw new HttpError(400, "invalid_parameter", "gameVersion may only contain letters, numbers, dots, and hyphens")
	}
	return value
}

function parseModLoaderType(value) {
	if (value === null) {
		throw new HttpError(400, "missing_parameter", "modLoaderType is required")
	}
	if (!/^(1|4|5|6)$/.test(value)) {
		throw new HttpError(400, "invalid_parameter", "modLoaderType must be one of: 1, 4, 5, 6")
	}
	return value
}

function assertJsonContentType(request) {
	const contentType = request.headers.get("Content-Type");
	if (!contentType || !contentType.toLowerCase().includes("application/json")) {
		throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json")
	}
}
async function readJsonObject(request) {
	assertJsonContentType(request);
	let body;
	try {
		body = await request.json()
	} catch {
		throw new HttpError(400, "invalid_json", "Request body must be valid JSON")
	}
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new HttpError(400, "invalid_json", "Request body must be a JSON object")
	}
	return body
}

function parseFingerprints(value) {
	if (!Array.isArray(value)) {
		throw new HttpError(400, "invalid_parameter", "fingerprints must be an array")
	}
	if (value.length < 1 || value.length > MAX_FINGERPRINTS) {
		throw new HttpError(400, "invalid_parameter", `fingerprints must contain between 1 and ${MAX_FINGERPRINTS} items`)
	}
	const fingerprints = [];
	for (const item of value) {
		if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > Number.MAX_SAFE_INTEGER) {
			throw new HttpError(400, "invalid_parameter", "each fingerprint must be a safe non-negative integer")
		}
		fingerprints.push(item)
	}
	return fingerprints
}
async function curseForgeFetch(env, path, init = {}) {
	const apiKey = requireSecret(env);
	const upstream = await fetch(`${CURSEFORGE_BASE_URL}${path}`, {
		...init,
		headers: {
			Accept: "application/json",
			"x-api-key": apiKey,
			...init.headers || {}
		}
	});
	const contentType = upstream.headers.get("Content-Type") || "application/json; charset=utf-8";
	const text = await upstream.text();
	return new Response(text, {
		status: upstream.status,
		headers: {
			"Content-Type": contentType,
			"Cache-Control": "no-store"
		}
	})
}

async function handleFingerprintRequest(request, env) {
	if (request.method !== "POST") {
		throw new HttpError(405, "method_not_allowed", "Method not allowed")
	}

	const body = await readJsonObject(request);
	const fingerprints = parseFingerprints(body.fingerprints);

	return curseForgeFetch(env, `/v1/fingerprints/${CURSEFORGE_MINECRAFT_GAME_ID}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			fingerprints
		})
	})
}
async function handleModRequest(request, env, modId) {
	if (request.method !== "GET") {
		throw new HttpError(405, "method_not_allowed", "Method not allowed")
	}
	return curseForgeFetch(env, `/v1/mods/${modId}`, {
		method: "GET"
	})
}
async function handleModFilesRequest(request, env, modId) {
	if (request.method !== "GET") {
		throw new HttpError(405, "method_not_allowed", "Method not allowed")
	}
	const url = new URL(request.url);
	const gameVersion = parseGameVersion(url.searchParams.get("gameVersion"));
	const modLoaderType = parseModLoaderType(url.searchParams.get("modLoaderType"));
	const params = new URLSearchParams;
	params.set("gameVersion", gameVersion);
	params.set("modLoaderType", modLoaderType);
	return curseForgeFetch(env, `/v1/mods/${modId}/files?${params.toString()}`, {
		method: "GET"
	})
}
async function route(request, env) {
	assertCorsAllowed(request, env);
	const url = new URL(request.url);
	const path = url.pathname;
	if (path === "/cf/fingerprints") {
		return handleFingerprintRequest(request, env)
	}
	const modMatch = path.match(/^\/cf\/mods\/([1-9][0-9]{0,15})$/);
	if (modMatch) {
		return handleModRequest(request, env, modMatch[1])
	}
	const modFilesMatch = path.match(/^\/cf\/mods\/([1-9][0-9]{0,15})\/files$/);
	if (modFilesMatch) {
		return handleModFilesRequest(request, env, modFilesMatch[1])
	}
	throw new HttpError(404, "not_found", "Route not found")
}
export default {
	async fetch(request, env) {
		const corsHeaders = buildCorsHeaders(request, env);
		try {
			if (request.method === "OPTIONS") {
				return handleOptions(request, env)
			}
			const response = await route(request, env);
			const headers = new Headers(response.headers);
			for (const [key, value] of Object.entries(corsHeaders)) {
				headers.set(key, value)
			}
			return new Response(response.body, {
				status: response.status,
				headers
			})
		} catch (error) {
			return errorResponse(error, corsHeaders)
		}
	}
};
