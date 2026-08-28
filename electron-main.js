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
app.setName(APP_NAME);
const requestCache = new Map;
let requestCacheLastOperation = Date.now();
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
const MODRINTH_CDN_PREFIX = "https://cdn.modrinth.com/data/";
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
	if (!directory) return undefined;
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
	for (const controller of activeFetchControllers) controller.abort();
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
	if (!isJarPath(resolved)) throw new Error(`Not a JAR file: ${path.basename(filePath)}`);
	return resolved
}
async function existingJarPaths(paths) {
	const output = [];
	for (const filePath of paths) {
		const resolved = resolveJarPath(filePath);
		try {
			const stat = await fs.stat(resolved);
			if (stat.isFile()) output.push(resolved)
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
	if (modrinthRequestsBlocked) throw new TooManyRequestsError;
	const key = cacheKey(method, url, body);
	if (useCache && requestCache.has(key)) return structuredClone(requestCache.get(key));
	const headers = {
		Accept: "application/json",
		"User-Agent": "minecraft-mod-updater"
	};
	if (body !== undefined) headers["Content-Type"] = "application/json";
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
		if (modrinthRequestsBlocked || error.name === "AbortError") throw new TooManyRequestsError;
		throw error
	} finally {
		activeFetchControllers.delete(controller)
	}
	if (response.status === 429) {
		abortActiveFetches();
		throw new TooManyRequestsError
	}
	if (response.status === 404) return null;
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`${response.status} ${response.statusText}: ${text.slice(0,500)}`)
	}
	const data = await response.json();
	if (useCache) requestCache.set(key, structuredClone(data));
	return data
}
async function getGameVersions() {
	const versions = await apiRequest({
		url: `${MODRINTH_API}/tag/game_version`,
		useCache: true
	}) || [];
	return versions.filter(version => version && version.version_type === "release" && typeof version.version === "string" && version.version).sort((left, right) => String(right.date || "").localeCompare(String(left.date || ""))).map(version => version.version)
}
async function readJar(filePath) {
	const resolved = resolveJarPath(filePath);
	const stat = await fs.stat(resolved);
	if (!stat.isFile()) throw new Error(`Not a file: ${path.basename(resolved)}`);
	const hash = crypto.createHash("sha1");
	await pipeline(nodeFs.createReadStream(resolved), new Transform({
		transform(chunk, _encoding, callback) {
			hash.update(chunk);
			callback()
		}
	}));
	return {
		path: resolved,
		fileName: path.basename(resolved),
		size: stat.size,
		sha1: hash.digest("hex")
	}
}
async function lookupModrinthBatch(files, useCache) {
	if (!files.length) return new Map;
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

function providerIdentityKeys(item) {
	const modrinthId = item.modrinth?.project?.id || item.modrinth?.version?.project_id || "";
	return modrinthId ? [`modrinth:${modrinthId}`] : []
}

function uniqueFilesByHash(files, knownHashes = []) {
	const hashes = new Set(knownHashes);
	const unique = [];
	for (const file of files) {
		if (hashes.has(file.sha1)) continue;
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
		if (keys.some(key => providerIds.has(key))) continue;
		for (const key of keys) providerIds.add(key);
		unique.push(item)
	}
	return unique
}
async function enrichFiles(files, useCache) {
	const modrinthErrors = [];
	let modrinthByHash = new Map;
	try {
		modrinthByHash = await lookupModrinthBatch(files, useCache)
	} catch (error) {
		if (error?.tooManyRequests) throw error;
		modrinthErrors.push(`Modrinth: ${error.message}`)
	}
	return files.map(file => ({
		...file,
		modrinth: modrinthByHash.get(file.sha1) || null,
		lookupErrors: modrinthErrors
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
async function findModrinthDownload(item, preferences, useCache) {
	const projectId = item.modrinth?.version?.project_id;
	if (!projectId) return null;
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
	if (!version) return null;
	const file = version.files.find(entry => entry.primary) || version.files[0];
	if (!file) return null;
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

function safeFileName(name) {
	return path.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
}

function safeNamePart(value) {
	return safeFileName(String(value || "").trim()).replace(/\s+/g, "_")
}

function plannedDownloadFileName(download) {
	const project = safeNamePart(download.projectSlug || download.projectId);
	const gameVersion = safeNamePart(download.gameVersion);
	const loader = safeNamePart(download.loader);
	const version = safeNamePart(download.versionName);
	return `${project}-${gameVersion}-${loader}-${version}.jar`
}

function validateDownloadMetadata(download) {
	if (!download?.url || !download.url.startsWith(MODRINTH_CDN_PREFIX) || download.url.includes("..")) {
		throw new Error("Invalid Modrinth CDN URL")
	}
	if (!isJarPath(download.fileName || "")) throw new Error("Downloaded file metadata is not a JAR");
	if (!isJarPath(plannedDownloadFileName(download))) throw new Error("Planned file name is not a JAR");
	if (!download.sha1 && !download.sha512) throw new Error("Downloaded file has no hash metadata")
}

function hashVerifier(download) {
	const sha1 = download.sha1 ? crypto.createHash("sha1") : null;
	const sha512 = download.sha512 ? crypto.createHash("sha512") : null;
	return new Transform({
		transform(chunk, _encoding, callback) {
			if (sha1) sha1.update(chunk);
			if (sha512) sha512.update(chunk);
			callback(null, chunk)
		},
		flush(callback) {
			if (sha1 && sha1.digest("hex") !== download.sha1) return callback(new Error("SHA-1 hash mismatch"));
			if (sha512 && sha512.digest("hex") !== download.sha512) return callback(new Error("SHA-512 hash mismatch"));
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
		if (modrinthRequestsBlocked || error.name === "AbortError") throw new TooManyRequestsError;
		throw error
	} finally {
		activeFetchControllers.delete(controller)
	}
	if (response.status === 429) {
		abortActiveFetches();
		throw new TooManyRequestsError
	}
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
	if (!response.body) throw new Error("Empty download body");
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
	if (!worksheetFile) throw new Error("Summary worksheet XML not found");
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
	if (!Array.isArray(items) || !items.length) throw new Error("No files imported");
	const result = await dialog.showSaveDialog({
		title: "Export summary",
		defaultPath: "minecraft-mod-updater-summary.xlsx",
		filters: [{
			name: "Excel Workbook",
			extensions: ["xlsx"]
		}]
	});
	if (result.canceled || !result.filePath) return {
		canceled: true
	};
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
		["Name", "JAR Name", "Source Found in Modrinth", "Target Found in Modrinth"]
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
	autoUpdater.on("update-available", async info => {
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
		autoUpdater.quitAndInstall()
	});
	autoUpdater.on("error", error => {
		console.error("Auto update failed:", error.message)
	});
	autoUpdater.checkForUpdates().catch(error => {
		console.error("Auto update failed:", error.message)
	})
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
		if (defaultPath) dialogOptions.defaultPath = defaultPath;
		const result = await dialog.showOpenDialog(dialogOptions);
		if (result.canceled) return [];
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
		if (defaultPath) dialogOptions.defaultPath = defaultPath;
		const result = await dialog.showOpenDialog(dialogOptions);
		if (result.canceled || !result.filePaths[0]) return [];
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
			let modrinthDownload = null;
			let modrinthError = "";
			if (!item.modrinth) {
				output.push({
					modrinthDownload,
					download: null,
					modrinthError
				});
				continue
			}
			try {
				modrinthDownload = await findModrinthDownload(item, preferences, useCache)
			} catch (error) {
				if (error?.tooManyRequests) throw error;
				modrinthDownload = null
			}
			output.push({
				modrinthDownload,
				download: modrinthDownload,
				modrinthError
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
		if (defaultPath) dialogOptions.defaultPath = defaultPath;
		const result = await dialog.showOpenDialog(dialogOptions);
		if (result.canceled || !result.filePaths[0]) return {
			canceled: true,
			results: []
		};
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
			if (confirmation.response !== 0) return {
				canceled: true,
				results: []
			};
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
				if (error?.tooManyRequests) throw error;
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
		if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Unsupported URL protocol");
		return shell.openExternal(parsed.toString())
	});
	createWindow();
	setupAutoUpdater();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit()
});
