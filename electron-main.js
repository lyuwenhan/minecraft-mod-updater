const {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	shell
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const APP_NAME = "Minecraft Mod Updater";
const MODRINTH_API = "https://api.modrinth.com/v2";
app.setName(APP_NAME);
const requestCache = new Map;
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

function createWindow() {
	const win = new BrowserWindow({
		title: APP_NAME,
		width: 1100,
		height: 760,
		minWidth: 860,
		minHeight: 600,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true
		}
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
	const key = cacheKey(method, url, body);
	if (useCache && requestCache.has(key)) return structuredClone(requestCache.get(key));
	const headers = {
		Accept: "application/json",
		"User-Agent": "minecraft-mod-updater/1.0.0 (Electron)"
	};
	if (body !== undefined) headers["Content-Type"] = "application/json";
	const response = await fetch(url, {
		method,
		headers,
		body
	});
	if (response.status === 404) return null;
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`${response.status} ${response.statusText}: ${text.slice(0,500)}`)
	}
	const data = await response.json();
	if (useCache) requestCache.set(key, structuredClone(data));
	return data
}
async function readJar(filePath) {
	const data = await fs.readFile(filePath);
	const stat = await fs.stat(filePath);
	return {
		path: filePath,
		fileName: path.basename(filePath),
		size: stat.size,
		sha1: crypto.createHash("sha1").update(data).digest("hex")
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
		fileName: file.filename,
		url: file.url,
		versionName: version.version_number || version.name
	}
}

function safeFileName(name) {
	return path.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
}
async function downloadFile(download, directory) {
	const response = await fetch(download.url, {
		headers: {
			"User-Agent": "minecraft-mod-updater/1.0.0 (Electron)"
		}
	});
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
	const targetPath = path.join(directory, safeFileName(download.fileName));
	await fs.writeFile(targetPath, Buffer.from(await response.arrayBuffer()))
}
app.whenReady().then(() => {
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
		const filePaths = result.filePaths.filter(file => path.extname(file).toLowerCase() === ".jar");
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
		return entries.filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === ".jar").map(entry => path.join(directory, entry.name))
	});
	ipcMain.handle("mods:import", async (_event, {
		paths,
		knownHashes = [],
		knownProviderIds = []
	}) => {
		const files = uniqueFilesByHash(await Promise.all(paths.map(filePath => readJar(filePath))), knownHashes);
		const enriched = await enrichFiles(files, true);
		return {
			items: uniqueFilesByProviderId(enriched, knownProviderIds)
		}
	});
	ipcMain.handle("mods:reload", async (_event, {
		items
	}) => {
		const files = await Promise.all(items.map(item => readJar(item.path)));
		return enrichFiles(files, false)
	});
	ipcMain.handle("mods:check-downloads", async (_event, {
		items,
		preferences,
		useCache
	}) => {
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
				modrinthError = error.message
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
		const directory = result.filePaths[0];
		await writeSettings({
			...settings,
			lastExportDirectory: directory
		});
		const results = [];
		for (const download of downloads) {
			try {
				await downloadFile(download, directory);
				results.push({
					ok: true
				})
			} catch {
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
	ipcMain.handle("shell:open-external", (_event, url) => {
		const parsed = new URL(url);
		if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Unsupported URL protocol");
		return shell.openExternal(parsed.toString())
	});
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit()
});
