const {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	shell,
	Menu
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const nodeFs = require("node:fs");
const {
	Readable,
	Transform
} = require("node:stream");
const {
	pipeline
} = require("node:stream/promises");
const crypto = require("node:crypto");
const XlsxPopulate = require("xlsx-populate");
const JSZip = require("jszip");
const {
	autoUpdater
} = require("electron-updater");
const APP_NAME = "Minecraft Mod Updater";
const MODRINTH_API = "https://api.modrinth.com/v2";
const MODRINTH_CDN_PREFIX = "https://cdn.modrinth.com/data/";
const CURSEFORGE_PROXY_BASE = "http://minecraft-mod-updater.lyuwenhan.workers.dev/cf";
const CURSEFORGE_DOWNLOAD_HOST = "edge.forgecdn.net";
const LYUWENHAN_EXTENSIONS_BASE = "https://lyuwenhan.github.io/extensions/minecraft-java";
const LYUWENHAN_EXTENSIONS_DATA_URL = `${LYUWENHAN_EXTENSIONS_BASE}/data/versions.json`;
const LYUWENHAN_EXTENSIONS_DIST_PREFIX = "/extensions/minecraft-java/data/dist/";
app.setName(APP_NAME);
const requestCache = new Map;
let requestCacheLastOperation = Date.now();
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
const settingsFileName = "settings.json";
async function readSettings() {
	try {
		return JSON.parse(await fs.readFile(path.join(app.getPath("userData"), settingsFileName), "utf8"))
	} catch {
		return {}
	}
}
async function writeSettings(settings) {
	const settingsPath = path.join(app.getPath("userData"), settingsFileName);
	await fs.mkdir(path.dirname(settingsPath), {
		recursive: true
	});
	await fs.writeFile(settingsPath, JSON.stringify(settings, null, "\t"))
}
async function getExistingDirectory(directory) {
	if (!directory) {
		return undefined
	}
	try {
		const stat = await fs.stat(directory);
		return stat.isDirectory() ? directory : undefined
	} catch {
		return undefined
	}
}

function todayKey(time = Date.now()) {
	return new Date(time).toISOString().slice(0, 10)
}

function clearExpiredRequestCache() {
	const now = Date.now();
	if (now - requestCacheLastOperation >= CACHE_MAX_AGE_MS || todayKey(now) !== todayKey(requestCacheLastOperation)) {
		requestCache.clear()
	}
	requestCacheLastOperation = now
}
setInterval(clearExpiredRequestCache, CACHE_MAX_AGE_MS);
class TooManyRequestsError extends Error {
	constructor() {
		super("Too many requests");
		this.name = "TooManyRequestsError";
		this.tooManyRequests = true
	}
}
let activeFetchControllers = new Set;
let modrinthRequestsBlocked = false;

function abortActiveFetches() {
	modrinthRequestsBlocked = true;
	for (const controller of activeFetchControllers) {
		controller.abort()
	}
	activeFetchControllers.clear()
}

function resetModrinthRequestBlock() {
	modrinthRequestsBlocked = false
}

function getErrorMessage(error) {
	return error?.tooManyRequests ? "Too many requests" : error.message
}

function isJarPath(filePath) {
	return path.extname(filePath).toLowerCase() === ".jar"
}

function resolveJarPath(filePath) {
	const resolved = path.resolve(filePath);
	if (!isJarPath(resolved)) {
		throw new Error(`Not a JAR file: ${path.basename(filePath)}`)
	}
	return resolved
}
async function existingJarPaths(paths) {
	const output = [];
	for (const filePath of paths) {
		const resolved = resolveJarPath(filePath);
		try {
			const stat = await fs.stat(resolved);
			if (stat.isFile()) {
				output.push(resolved)
			}
		} catch {}
	}
	return output
}

function createWindow() {
	const win = new BrowserWindow({
		title: `${APP_NAME} v${app.getVersion()}`,
		width: 1100,
		height: 760,
		minWidth: 860,
		minHeight: 600,
		autoHideMenuBar: app.isPackaged,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			devTools: !app.isPackaged
		}
	});
	if (app.isPackaged) {
		win.webContents.setZoomFactor(1);
		win.webContents.setVisualZoomLevelLimits(1, 1);
		win.webContents.on("will-navigate", event => {
			event.preventDefault()
		})
	}
	win.on("page-title-updated", event => {
		event.preventDefault()
	});
	win.loadFile("index.html")
}

function cacheKey(method, url, body) {
	return JSON.stringify([method, url, body || ""])
}
async function apiRequest({
	method = "GET",
	url,
	body,
	useCache = true
}) {
	clearExpiredRequestCache();
	if (modrinthRequestsBlocked) {
		throw new TooManyRequestsError
	}
	const key = cacheKey(method, url, body);
	if (useCache && requestCache.has(key)) {
		return structuredClone(requestCache.get(key))
	}
	const headers = {
		Accept: "application/json",
		"User-Agent": "minecraft-mod-updater"
	};
	if (body !== undefined) {
		headers["Content-Type"] = "application/json"
	}
	const controller = new AbortController;
	activeFetchControllers.add(controller);
	let response;
	try {
		response = await fetch(url, {
			method,
			headers,
			body,
			signal: controller.signal
		})
	} catch (error) {
		if (modrinthRequestsBlocked || error.name === "AbortError") {
			throw new TooManyRequestsError
		}
		throw error
	} finally {
		activeFetchControllers.delete(controller)
	}
	if (response.status === 429) {
		abortActiveFetches();
		throw new TooManyRequestsError
	}
	if (response.status === 404) {
		return null
	}
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`${response.status} ${response.statusText}: ${text.slice(0,500)}`)
	}
	const data = await response.json();
	if (useCache) {
		requestCache.set(key, structuredClone(data))
	}
	return data
}
async function lyuwenhanExtensionsRequest(useCache = true) {
	clearExpiredRequestCache();
	const key = cacheKey("GET", LYUWENHAN_EXTENSIONS_DATA_URL);
	if (useCache && requestCache.has(key)) {
		return structuredClone(requestCache.get(key))
	}
	const controller = new AbortController;
	activeFetchControllers.add(controller);
	let response;
	try {
		response = await fetch(LYUWENHAN_EXTENSIONS_DATA_URL, {
			headers: {
				Accept: "application/json",
				"User-Agent": "minecraft-mod-updater"
			},
			signal: controller.signal
		})
	} finally {
		activeFetchControllers.delete(controller)
	}
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`${response.status} ${response.statusText}: ${text.slice(0,500)}`)
	}
	const data = await response.json();
	if (useCache) {
		requestCache.set(key, structuredClone(data))
	}
	return data
}
async function getGameVersions() {
	const versions = await apiRequest({
		url: `${MODRINTH_API}/tag/game_version`,
		useCache: true
	}) || [];
	return versions.filter(version => version && version.version_type === "release" && typeof version.version === "string" && version.version).sort((left, right) => String(right.date || "").localeCompare(String(left.date || ""))).map(version => version.version)
}

function curseForgeFingerprintBuffer(buffer) {
	const filtered = [];
	for (const byte of buffer) {
		if (byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32) {
			filtered.push(byte)
		}
	}
	const length = filtered.length;
	let hash = 1 ^ length;
	let index = 0;
	while (index <= length - 4) {
		let k = filtered[index] | filtered[index + 1] << 8 | filtered[index + 2] << 16 | filtered[index + 3] << 24;
		k = Math.imul(k, 1540483477);
		k ^= k >>> 24;
		k = Math.imul(k, 1540483477);
		hash = Math.imul(hash, 1540483477);
		hash ^= k;
		index += 4
	}
	const remaining = length - index;
	if (remaining === 3) {
		hash ^= filtered[index + 2] << 16
	}
	if (remaining >= 2) {
		hash ^= filtered[index + 1] << 8
	}
	if (remaining >= 1) {
		hash ^= filtered[index];
		hash = Math.imul(hash, 1540483477)
	}
	hash ^= hash >>> 13;
	hash = Math.imul(hash, 1540483477);
	hash ^= hash >>> 15;
	return hash >>> 0
}
async function readJar(filePath) {
	const resolved = resolveJarPath(filePath);
	const stat = await fs.stat(resolved);
	if (!stat.isFile()) {
		throw new Error(`Not a file: ${path.basename(resolved)}`)
	}
	const buffer = await fs.readFile(resolved);
	return {
		path: resolved,
		fileName: path.basename(resolved),
		size: stat.size,
		sha1: crypto.createHash("sha1").update(buffer).digest("hex"),
		curseForgeFingerprint: curseForgeFingerprintBuffer(buffer)
	}
}

function lyuwenhanExtensionsItem(data, sha1) {
	const sha1Entry = data?.data?.sha1?.[sha1];
	if (!sha1Entry || typeof sha1Entry.id !== "string" || !sha1Entry.id) {
		return null
	}
	const info = data?.[sha1Entry.id];
	if (!info || typeof info !== "object" || Array.isArray(info)) {
		return null
	}
	const links = info.link && typeof info.link === "object" && !Array.isArray(info.link) ? info.link : {};
	return {
		id: sha1Entry.id,
		version: typeof sha1Entry.version === "string" ? sha1Entry.version : "",
		versions: Array.isArray(info.versions) ? info.versions.filter(version => typeof version === "string") : [],
		hasIcon: info.hasIcon === true,
		displayName: typeof info.displayName === "string" ? info.displayName : "",
		description: typeof info.description === "string" ? info.description : "",
		link: links,
		iconUrl: info.hasIcon === true ? `${LYUWENHAN_EXTENSIONS_BASE}/data/assets/${encodeURIComponent(sha1Entry.id)}/icon.png` : ""
	}
}
async function lookupLyuwenhanExtensionsBatch(files, useCache) {
	const output = new Map;
	if (!files.length) {
		return output
	}
	const data = await lyuwenhanExtensionsRequest(useCache);
	for (const file of files) {
		const item = lyuwenhanExtensionsItem(data, file.sha1);
		if (item) {
			output.set(file.sha1, item)
		}
	}
	return output
}
async function lookupModrinthBatch(files, useCache) {
	if (!files.length) {
		return new Map
	}
	const hashes = [...new Set(files.map(file => file.sha1))];
	const versionsByHash = await apiRequest({
		method: "POST",
		url: `${MODRINTH_API}/version_files`,
		body: JSON.stringify({
			hashes,
			algorithm: "sha1"
		}),
		useCache
	}) || {};
	const projectIds = [...new Set(Object.values(versionsByHash).map(version => version?.project_id).filter(Boolean))];
	let projects = [];
	if (projectIds.length) {
		const params = new URLSearchParams({
			ids: JSON.stringify(projectIds)
		});
		projects = await apiRequest({
			url: `${MODRINTH_API}/projects?${params}`,
			useCache
		}) || []
	}
	const projectsById = new Map(projects.map(project => [project.id, project]));
	const output = new Map;
	for (const hash of hashes) {
		const version = versionsByHash[hash] || null;
		output.set(hash, version ? {
			version,
			project: projectsById.get(version.project_id) || null
		} : null)
	}
	return output
}

function chunkArray(items, size) {
	const chunks = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size))
	}
	return chunks
}
async function lookupCurseForgeBatch(files, useCache) {
	if (!files.length) {
		return new Map
	}
	const filesByFingerprint = new Map;
	for (const file of files) {
		if (Number.isInteger(file.curseForgeFingerprint)) {
			filesByFingerprint.set(file.curseForgeFingerprint, file)
		}
	}
	const output = new Map(files.map(file => [file.sha1, null]));
	if (!filesByFingerprint.size) {
		return output
	}
	const matches = [];
	for (const fingerprints of chunkArray([...filesByFingerprint.keys()], 100)) {
		const response = await apiRequest({
			method: "POST",
			url: `${CURSEFORGE_PROXY_BASE}/fingerprints`,
			body: JSON.stringify({
				fingerprints
			}),
			useCache
		}) || {};
		for (const match of response?.data?.exactMatches || []) {
			matches.push(match)
		}
	}
	const modIds = [...new Set(matches.map(match => match?.id || match?.file?.modId).filter(id => Number.isInteger(id)))];
	const modsById = new Map;
	await Promise.all(modIds.map(async modId => {
		const response = await apiRequest({
			url: `${CURSEFORGE_PROXY_BASE}/mods/${encodeURIComponent(modId)}`,
			useCache
		});
		if (response?.data) {
			modsById.set(modId, response.data)
		}
	}));
	for (const match of matches) {
		const fingerprint = match?.file?.fileFingerprint;
		const file = filesByFingerprint.get(fingerprint);
		if (!file) {
			continue
		}
		const modId = match?.id || match?.file?.modId;
		output.set(file.sha1, {
			match,
			file: match?.file || null,
			mod: modsById.get(modId) || null
		})
	}
	return output
}

function providerIdentityKeys(item) {
	const keys = [];
	if (item.lyuwenhanExtensions?.id) {
		keys.push(`lyuwenhan:${item.lyuwenhanExtensions.id}`)
	}
	const modrinthId = item.modrinth?.project?.id || item.modrinth?.version?.project_id || "";
	if (modrinthId) {
		keys.push(`modrinth:${modrinthId}`)
	}
	const curseForgeId = item.curseforge?.mod?.id || item.curseforge?.file?.modId || item.curseforge?.match?.id || "";
	if (curseForgeId) {
		keys.push(`curseforge:${curseForgeId}`)
	}
	return keys
}

function uniqueFilesByHash(files, knownHashes = []) {
	const hashes = new Set(knownHashes);
	const unique = [];
	for (const file of files) {
		if (hashes.has(file.sha1)) {
			continue
		}
		hashes.add(file.sha1);
		unique.push(file)
	}
	return unique
}

function uniqueFilesByProviderId(items, knownProviderIds = []) {
	const providerIds = new Set(knownProviderIds);
	const unique = [];
	for (const item of items) {
		const keys = providerIdentityKeys(item);
		if (keys.some(key => providerIds.has(key))) {
			continue
		}
		for (const key of keys) {
			providerIds.add(key)
		}
		unique.push(item)
	}
	return unique
}
async function enrichFiles(files, useCache) {
	const lookupErrors = [];
	let lyuwenhanExtensionsByHash = new Map;
	try {
		lyuwenhanExtensionsByHash = await lookupLyuwenhanExtensionsBatch(files, useCache)
	} catch (error) {
		lookupErrors.push(`Lyuwenhan Extensions: ${error.message}`)
	}
	const fallbackFiles = files.filter(file => !lyuwenhanExtensionsByHash.has(file.sha1));
	let modrinthByHash = new Map;
	let curseForgeByHash = new Map;
	const [modrinthResult, curseForgeResult] = await Promise.allSettled([lookupModrinthBatch(fallbackFiles, useCache), lookupCurseForgeBatch(fallbackFiles, useCache)]);
	if (modrinthResult.status === "fulfilled") {
		modrinthByHash = modrinthResult.value
	} else {
		if (modrinthResult.reason?.tooManyRequests) {
			throw modrinthResult.reason
		}
		lookupErrors.push(`Modrinth: ${modrinthResult.reason.message}`)
	}
	if (curseForgeResult.status === "fulfilled") {
		curseForgeByHash = curseForgeResult.value
	} else {
		lookupErrors.push(`CurseForge: ${curseForgeResult.reason.message}`)
	}
	return files.map(file => ({
		...file,
		lyuwenhanExtensions: lyuwenhanExtensionsByHash.get(file.sha1) || null,
		modrinth: lyuwenhanExtensionsByHash.has(file.sha1) ? null : modrinthByHash.get(file.sha1) || null,
		curseforge: lyuwenhanExtensionsByHash.has(file.sha1) ? null : curseForgeByHash.get(file.sha1) || null,
		lookupErrors
	}))
}

function acceptableRelease(type, minimum) {
	const rank = {
		alpha: 0,
		beta: 1,
		release: 2
	};
	return rank[type] >= rank[minimum]
}
async function findLyuwenhanExtensionsDownload(item, preferences, useCache) {
	const id = item.lyuwenhanExtensions?.id;
	if (!id || !preferences.gameVersion) {
		return null
	}
	const data = await lyuwenhanExtensionsRequest(useCache);
	if (data?.data?.ext !== "jar") {
		return null
	}
	const version = data?.data?.["newest-version"]?.[id]?.[preferences.gameVersion];
	if (typeof version !== "string" || !version) {
		return null
	}
	let sha1 = "";
	for (const [hash, entry] of Object.entries(data?.data?.sha1 || {})) {
		if (entry?.id === id && entry?.version === version) {
			sha1 = hash;
			break
		}
	}
	return {
		provider: "lyuwenhan",
		projectId: id,
		projectSlug: id,
		gameVersion: preferences.gameVersion,
		loader: preferences.loader,
		fileName: `${id}-${version}.jar`,
		url: `${LYUWENHAN_EXTENSIONS_BASE}/data/dist/${encodeURIComponent(id)}-${encodeURIComponent(version)}.jar`,
		sha1,
		sha512: "",
		versionName: version
	}
}

function curseForgeModLoaderType(loader) {
	const normalized = String(loader || "").trim().toLocaleLowerCase();
	if (normalized === "forge") {
		return 1
	}
	if (normalized === "fabric") {
		return 4
	}
	if (normalized === "quilt") {
		return 5
	}
	if (normalized === "neoforge") {
		return 6
	}
	return null
}

function curseForgeReleaseTypeName(releaseType) {
	if (releaseType === 1) {
		return "release"
	}
	if (releaseType === 2) {
		return "beta"
	}
	return "alpha"
}

function curseForgeSha1(file) {
	const hash = (file?.hashes || []).find(entry => entry?.algo === 1 && typeof entry.value === "string" && /^[a-fA-F0-9]{40}$/.test(entry.value));
	return hash?.value?.toLowerCase() || ""
}
async function findModrinthDownload(item, preferences, useCache) {
	const projectId = item.modrinth?.version?.project_id;
	if (!projectId) {
		return null
	}
	const params = new URLSearchParams({
		loaders: JSON.stringify([preferences.loader]),
		game_versions: JSON.stringify([preferences.gameVersion]),
		include_changelog: "false"
	});
	const versions = await apiRequest({
		url: `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${params}`,
		useCache
	});
	const version = versions?.find(entry => acceptableRelease(entry.version_type, preferences.minimumRelease));
	if (!version) {
		return null
	}
	const file = version.files.find(entry => entry.primary) || version.files[0];
	if (!file) {
		return null
	}
	return {
		provider: "modrinth",
		projectId,
		projectSlug: item.modrinth?.project?.slug || projectId,
		gameVersion: preferences.gameVersion,
		loader: preferences.loader,
		fileName: file.filename,
		url: file.url,
		sha1: file.hashes?.sha1 || "",
		sha512: file.hashes?.sha512 || "",
		versionName: version.version_number || version.name
	}
}
async function findCurseForgeDownload(item, preferences, useCache) {
	const modId = item.curseforge?.mod?.id || item.curseforge?.file?.modId || item.curseforge?.match?.id;
	const modLoaderType = curseForgeModLoaderType(preferences.loader);
	if (!modId || !preferences.gameVersion || !modLoaderType) {
		return null
	}
	const params = new URLSearchParams({
		gameVersion: preferences.gameVersion,
		modLoaderType: String(modLoaderType)
	});
	const response = await apiRequest({
		url: `${CURSEFORGE_PROXY_BASE}/mods/${encodeURIComponent(modId)}/files?${params}`,
		useCache
	});
	const files = Array.isArray(response?.data) ? response.data : [];
	const file = files.find(entry => entry?.isAvailable !== false && typeof entry.downloadUrl === "string" && entry.downloadUrl && acceptableRelease(curseForgeReleaseTypeName(entry.releaseType), preferences.minimumRelease));
	if (!file) {
		return null
	}
	return {
		provider: "curseforge",
		projectId: String(modId),
		projectSlug: item.curseforge?.mod?.slug || String(modId),
		gameVersion: preferences.gameVersion,
		loader: preferences.loader,
		fileName: file.fileName,
		url: file.downloadUrl,
		sha1: curseForgeSha1(file),
		sha512: "",
		versionName: file.displayName || file.fileName
	}
}

function safeFileName(name) {
	return path.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
}

function safeNamePart(value) {
	return safeFileName(String(value || "").trim()).replace(/\s+/g, "_")
}

function plannedDownloadFileName(download) {
	if (download.provider === "lyuwenhan") {
		return safeFileName(download.fileName)
	}
	const project = safeNamePart(download.projectSlug || download.projectId);
	const gameVersion = safeNamePart(download.gameVersion);
	const loader = safeNamePart(download.loader);
	const version = safeNamePart(download.versionName);
	return `${project}-${gameVersion}-${loader}-${version}.jar`
}

function validDownloadUrl(download) {
	try {
		const parsed = new URL(download.url);
		if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
			return false
		}
		if (download.provider === "modrinth") {
			return download.url.startsWith(MODRINTH_CDN_PREFIX) && !download.url.includes("..")
		}
		if (download.provider === "curseforge") {
			return parsed.hostname === CURSEFORGE_DOWNLOAD_HOST && parsed.pathname.startsWith("/files/") && !parsed.pathname.includes("..")
		}
		if (download.provider === "lyuwenhan") {
			return parsed.hostname === "lyuwenhan.github.io" && parsed.pathname.startsWith(LYUWENHAN_EXTENSIONS_DIST_PREFIX) && !parsed.pathname.includes("..")
		}
		return false
	} catch {
		return false
	}
}

function validateDownloadMetadata(download) {
	if (!download?.url || !validDownloadUrl(download)) {
		throw new Error("Invalid download URL")
	}
	if (!isJarPath(download.fileName || "")) {
		throw new Error("Downloaded file metadata is not a JAR")
	}
	if (!isJarPath(plannedDownloadFileName(download))) {
		throw new Error("Planned file name is not a JAR")
	}
	if ((download.provider === "modrinth" || download.provider === "curseforge") && !download.sha1 && !download.sha512) {
		throw new Error("Downloaded file has no hash metadata")
	}
}

function hashVerifier(download) {
	const sha1 = download.sha1 ? crypto.createHash("sha1") : null;
	const sha512 = download.sha512 ? crypto.createHash("sha512") : null;
	return new Transform({
		transform(chunk, _encoding, callback) {
			if (sha1) {
				sha1.update(chunk)
			}
			if (sha512) {
				sha512.update(chunk)
			}
			callback(null, chunk)
		},
		flush(callback) {
			if (sha1 && sha1.digest("hex") !== download.sha1) {
				return callback(new Error("SHA-1 hash mismatch"))
			}
			if (sha512 && sha512.digest("hex") !== download.sha512) {
				return callback(new Error("SHA-512 hash mismatch"))
			}
			callback()
		}
	})
}
async function downloadFile(download, directory) {
	validateDownloadMetadata(download);
	const controller = new AbortController;
	activeFetchControllers.add(controller);
	let response;
	try {
		response = await fetch(download.url, {
			headers: {
				"User-Agent": "minecraft-mod-updater"
			},
			signal: controller.signal
		})
	} catch (error) {
		if (download.provider === "modrinth" && (modrinthRequestsBlocked || error.name === "AbortError")) {
			throw new TooManyRequestsError
		}
		throw error
	} finally {
		activeFetchControllers.delete(controller)
	}
	if (response.status === 429 && download.provider === "modrinth") {
		abortActiveFetches();
		throw new TooManyRequestsError
	}
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`)
	}
	if (!response.body) {
		throw new Error("Empty download body")
	}
	const finalPath = path.resolve(directory, plannedDownloadFileName(download));
	const tempPath = `${finalPath}.download`;
	try {
		await pipeline(Readable.fromWeb(response.body), hashVerifier(download), nodeFs.createWriteStream(tempPath, {
			flags: "wx"
		}));
		await fs.rename(tempPath, finalPath)
	} catch (error) {
		await fs.rm(tempPath, {
			force: true
		});
		throw error
	}
}
async function clearDirectory(directory) {
	const entries = await fs.readdir(directory);
	await Promise.all(entries.map(entry => fs.rm(path.join(directory, entry), {
		recursive: true,
		force: true
	})))
}

function validHttpUrl(value) {
	try {
		const url = new URL(value);
		return ["https:", "http:"].includes(url.protocol) ? url.toString() : ""
	} catch {
		return ""
	}
}

function applyTableBorders(worksheet, firstRow, lastRow) {
	for (let row = firstRow; row <= lastRow; row++) {
		for (let column = 1; column <= 4; column++) {
			worksheet.cell(row, column).style({
				border: {
					top: row === firstRow ? "medium" : "thin",
					bottom: row === lastRow ? "medium" : "thin",
					left: column === 1 ? "medium" : "thin",
					right: column === 4 ? "medium" : "thin"
				}
			})
		}
	}
}
async function addAutoFilterToWorkbook(filePath, filterRange) {
	const workbookBuffer = await fs.readFile(filePath);
	const zip = await JSZip.loadAsync(workbookBuffer);
	const worksheetPath = "xl/worksheets/sheet1.xml";
	const worksheetFile = zip.file(worksheetPath);
	if (!worksheetFile) {
		throw new Error("Summary worksheet XML not found")
	}
	let worksheetXml = await worksheetFile.async("string");
	worksheetXml = worksheetXml.replace(/<autoFilter\b[^>]*\/>/g, "").replace(/<autoFilter\b[\s\S]*?<\/autoFilter>/g, "");
	if (!worksheetXml.includes("</sheetData>")) {
		throw new Error("Summary worksheet data XML not found")
	}
	worksheetXml = worksheetXml.replace("</sheetData>", `</sheetData><autoFilter ref="${filterRange}"/>`);
	zip.file(worksheetPath, worksheetXml);
	const output = await zip.generateAsync({
		type: "nodebuffer",
		compression: "DEFLATE"
	});
	await fs.writeFile(filePath, output)
}

function capitalizeFirst(value) {
	const text = String(value || "");
	return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : ""
}
async function exportSummaryWorkbook({
	targetVersion,
	targetLoader,
	items
}) {
	if (!Array.isArray(items) || !items.length) {
		throw new Error("No files imported")
	}
	const result = await dialog.showSaveDialog({
		title: "Export summary",
		defaultPath: "minecraft-mod-updater-summary.xlsx",
		filters: [{
			name: "Excel Workbook",
			extensions: ["xlsx"]
		}]
	});
	if (result.canceled || !result.filePath) {
		return {
			canceled: true
		}
	}
	const workbook = await XlsxPopulate.fromBlankAsync();
	const worksheet = workbook.sheet(0);
	worksheet.name("Summary");
	worksheet.range("A1:D1").merged(true);
	worksheet.cell("A1").value("Statistics");
	worksheet.range("A2:D2").value([
		["Target Version", "Target Loader", "Source Found", "Target Found"]
	]);
	worksheet.cell("A3").value(String(targetVersion || ""));
	worksheet.cell("B3").value(capitalizeFirst(targetLoader));
	worksheet.range("A5:D5").value([
		["Name", "JAR Name", "Source Found", "Target Found"]
	]);
	let rowIndex = 6;
	for (const item of items) {
		const sourceFound = item.sourceFound === true;
		const targetFound = item.targetFound === true;
		const url = validHttpUrl(item.url);
		const name = String(item.name || "").trim() || "N/A";
		worksheet.range(`A${rowIndex}:D${rowIndex}`).value([
			[name, String(item.fileName || ""), sourceFound ? "✓" : "✕", targetFound ? "✓" : "✕"]
		]);
		if (name !== "N/A" && url) {
			worksheet.cell(`A${rowIndex}`).hyperlink(url).style({
				fontColor: "0563C1",
				underline: true
			})
		}
		rowIndex++
	}
	const lastDataRow = Math.max(6, rowIndex - 1);
	worksheet.cell("C3").formula(`COUNTIF(C6:C${lastDataRow},"✓")&" / "&(COUNTIF(C6:C${lastDataRow},"✓")+COUNTIF(C6:C${lastDataRow},"✕"))`);
	worksheet.cell("D3").formula(`COUNTIF(D6:D${lastDataRow},"✓")&" / "&(COUNTIF(D6:D${lastDataRow},"✓")+COUNTIF(D6:D${lastDataRow},"✕"))`);
	worksheet.range(`A1:D${lastDataRow}`).style({
		fontFamily: "Arial",
		fontSize: 12,
		horizontalAlignment: "center",
		verticalAlignment: "center",
		numberFormat: "@",
		shrinkToFit: true
	});
	worksheet.range("A1:D1").style("bold", true);
	worksheet.range("A2:D2").style("bold", true);
	worksheet.range("A5:D5").style("bold", true);
	applyTableBorders(worksheet, 1, 3);
	applyTableBorders(worksheet, 5, lastDataRow);
	const rowHeight = 43.5;
	const defaultColumnWidth = 29.2857142857;
	const wideColumnWidth = 42.1428571429;
	for (let row = 1; row <= lastDataRow; row++) {
		worksheet.row(row).height(rowHeight)
	}
	worksheet.column("A").width(wideColumnWidth);
	worksheet.column("B").width(wideColumnWidth);
	worksheet.column("C").width(defaultColumnWidth);
	worksheet.column("D").width(defaultColumnWidth);
	const outputPath = path.resolve(result.filePath);
	await workbook.toFileAsync(outputPath);
	await addAutoFilterToWorkbook(outputPath, `A5:D${lastDataRow}`);
	return {
		canceled: false
	}
}

function setupAutoUpdater() {
	if (!app.isPackaged) {
		return
	}
	if (process.platform === "win32" && process.env.PORTABLE_EXECUTABLE_DIR) {
		return
	}
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
	let isCheckingForUpdates = false;
	let updateCheckInterval = null;
	async function checkForUpdates() {
		if (isCheckingForUpdates) {
			return
		}
		isCheckingForUpdates = true;
		try {
			await autoUpdater.checkForUpdates()
		} catch (error) {
			console.error("Auto update failed:", error.message)
		}
		isCheckingForUpdates = false
	}
	autoUpdater.on("update-available", async info => {
		if (updateCheckInterval) {
			clearInterval(updateCheckInterval);
			updateCheckInterval = null
		}
		const settings = await readSettings();
		if (settings.skippedUpdateVersion === info.version) {
			return
		}
		const result = await dialog.showMessageBox({
			type: "info",
			title: "Update available",
			message: `Minecraft Mod Updater v${info.version} is available.`,
			detail: "Would you like to download and install this update now?",
			buttons: ["Update now", "Later", "Skip this version"],
			defaultId: 0,
			cancelId: 1
		});
		if (result.response === 0) {
			try {
				await autoUpdater.downloadUpdate()
			} catch (error) {
				console.error("Update download failed:", error.message)
			}
			return
		}
		if (result.response === 2) {
			await writeSettings({
				...settings,
				skippedUpdateVersion: info.version
			})
		}
	});
	autoUpdater.on("update-downloaded", () => {
		autoUpdater.quitAndInstall(true, true)
	});
	autoUpdater.on("error", error => {
		console.error("Auto update failed:", error.message)
	});
	updateCheckInterval = setInterval(checkForUpdates, 10 * 60 * 1e3);
	checkForUpdates()
}
app.whenReady().then(() => {
	if (app.isPackaged) {
		Menu.setApplicationMenu(null)
	}
	ipcMain.handle("modrinth:game-versions", async () => {
		resetModrinthRequestBlock();
		return getGameVersions()
	});
	ipcMain.handle("files:select", async () => {
		const settings = await readSettings();
		const defaultPath = await getExistingDirectory(settings.lastImportDirectory);
		const dialogOptions = {
			title: "Import mod JAR files",
			properties: ["openFile", "multiSelections"],
			filters: [{
				name: "Minecraft mods",
				extensions: ["jar"]
			}]
		};
		if (defaultPath) {
			dialogOptions.defaultPath = defaultPath
		}
		const result = await dialog.showOpenDialog(dialogOptions);
		if (result.canceled) {
			return []
		}
		const filePaths = await existingJarPaths(result.filePaths);
		if (filePaths[0]) {
			await writeSettings({
				...settings,
				lastImportDirectory: path.dirname(filePaths[0])
			})
		}
		return filePaths
	});
	ipcMain.handle("folder:select-jars", async () => {
		const settings = await readSettings();
		const defaultPath = await getExistingDirectory(settings.lastImportDirectory);
		const dialogOptions = {
			title: "Import mods from folder",
			properties: ["openDirectory"]
		};
		if (defaultPath) {
			dialogOptions.defaultPath = defaultPath
		}
		const result = await dialog.showOpenDialog(dialogOptions);
		if (result.canceled || !result.filePaths[0]) {
			return []
		}
		const directory = result.filePaths[0];
		await writeSettings({
			...settings,
			lastImportDirectory: directory
		});
		const entries = await fs.readdir(directory, {
			withFileTypes: true
		});
		return entries.filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === ".jar").map(entry => path.resolve(directory, entry.name))
	});
	ipcMain.handle("mods:import", async (_event, {
		paths,
		knownHashes = [],
		knownProviderIds = []
	}) => {
		resetModrinthRequestBlock();
		const jarPaths = await existingJarPaths(paths);
		const files = uniqueFilesByHash(await Promise.all(jarPaths.map(filePath => readJar(filePath))), knownHashes);
		const enriched = await enrichFiles(files, true);
		return {
			items: uniqueFilesByProviderId(enriched, knownProviderIds)
		}
	});
	ipcMain.handle("mods:reload", async (_event, {
		items
	}) => {
		resetModrinthRequestBlock();
		const jarPaths = await existingJarPaths(items.map(item => item.path));
		const files = await Promise.all(jarPaths.map(filePath => readJar(filePath)));
		return enrichFiles(files, false)
	});
	ipcMain.handle("mods:check-downloads", async (_event, {
		items,
		preferences,
		useCache
	}) => {
		resetModrinthRequestBlock();
		const output = [];
		for (const item of items) {
			let download = null;
			let modrinthDownload = null;
			let curseforgeDownload = null;
			let downloadError = "";
			const errors = [];
			try {
				if (item.lyuwenhanExtensions) {
					download = await findLyuwenhanExtensionsDownload(item, preferences, useCache)
				} else {
					const checks = [];
					if (item.modrinth) {
						checks.push(findModrinthDownload(item, preferences, useCache).then(result => {
							modrinthDownload = result
						}).catch(error => {
							if (error?.tooManyRequests) {
								throw error
							}
							errors.push(`Modrinth: ${getErrorMessage(error)}`)
						}))
					}
					if (item.curseforge) {
						checks.push(findCurseForgeDownload(item, preferences, useCache).then(result => {
							curseforgeDownload = result
						}).catch(error => {
							errors.push(`CurseForge: ${getErrorMessage(error)}`)
						}))
					}
					await Promise.all(checks);
					download = modrinthDownload || curseforgeDownload
				}
			} catch (error) {
				if (error?.tooManyRequests) {
					throw error
				}
				download = null;
				modrinthDownload = null;
				curseforgeDownload = null;
				errors.push(`${item.lyuwenhanExtensions?"Lyuwenhan Extensions":"Download"}: ${getErrorMessage(error)}`)
			}
			downloadError = errors.join("\n");
			output.push({
				download,
				downloadError,
				modrinthDownload,
				modrinthError: "",
				curseforgeDownload,
				curseforgeError: ""
			})
		}
		return output
	});
	ipcMain.handle("downloads:choose-and-save", async (_event, {
		downloads
	}) => {
		resetModrinthRequestBlock();
		const settings = await readSettings();
		const defaultPath = await getExistingDirectory(settings.lastExportDirectory);
		const dialogOptions = {
			title: "Select download location",
			properties: ["openDirectory", "createDirectory"]
		};
		if (defaultPath) {
			dialogOptions.defaultPath = defaultPath
		}
		const result = await dialog.showOpenDialog(dialogOptions);
		if (result.canceled || !result.filePaths[0]) {
			return {
				canceled: true,
				results: []
			}
		}
		const directory = path.resolve(result.filePaths[0]);
		await writeSettings({
			...settings,
			lastExportDirectory: directory
		});
		const existingEntries = await fs.readdir(directory);
		if (existingEntries.length) {
			const confirmation = await dialog.showMessageBox({
				type: "warning",
				buttons: ["Continue", "Cancel"],
				defaultId: 1,
				cancelId: 1,
				title: "Clear download folder",
				message: "The selected folder is not empty.",
				detail: "Continuing will clear the folder before downloading. Continue?"
			});
			if (confirmation.response !== 0) {
				return {
					canceled: true,
					results: []
				}
			}
			await clearDirectory(directory)
		}
		const results = [];
		for (const download of downloads) {
			try {
				await downloadFile(download, directory);
				results.push({
					ok: true
				})
			} catch (error) {
				if (error?.tooManyRequests) {
					throw error
				}
				results.push({
					ok: false
				})
			}
		}
		return {
			canceled: false,
			results
		}
	});
	ipcMain.handle("summary:export", async (_event, payload) => exportSummaryWorkbook(payload));
	ipcMain.handle("shell:open-external", (_event, url) => {
		const parsed = new URL(url);
		if (!["https:", "http:"].includes(parsed.protocol)) {
			throw new Error("Unsupported URL protocol")
		}
		return shell.openExternal(parsed.toString())
	});
	createWindow();
	setupAutoUpdater();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow()
		}
	})
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit()
	}
});
