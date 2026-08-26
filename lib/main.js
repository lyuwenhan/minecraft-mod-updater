const searchQueryEl = document.getElementById("search-query");
const sourceFilterEl = document.getElementById("source-filter");
const targetFilterEl = document.getElementById("target-filter");
const operationPanelEl = document.getElementById("operation-panel");
const importFilesEl = document.getElementById("import-files");
const importFilesFolderEl = document.getElementById("import-files-folder");
const clearImportFilesEl = document.getElementById("clear-import-files");
const reloadEl = document.getElementById("reload");
const startSearchEl = document.getElementById("start-search");
const targetVersionSelectEl = document.getElementById("target-version-select");
const targetVersionEl = document.getElementById("target-version");
const targetLoaderEl = document.getElementById("target-loader");
const targetLoaderCustomEl = document.getElementById("target-loader-custom");
const minimumReleaseEl = document.getElementById("minimum-release");
const statusEl = document.getElementById("status");
const STORAGE_KEYS = {
	targetVersion: "target-game-version",
	targetLoader: "target-loader",
	minimumRelease: "minimum-release-level"
};
let importedFiles = [];
const importedHashes = new Set;
const importedProviderIds = new Set;
let busy = false;
let targetAction = "search";
let targetSearched = false;
minimumReleaseEl.value = localStorage.getItem(STORAGE_KEYS.minimumRelease) || "beta";
initializeTargetVersionControl(localStorage.getItem(STORAGE_KEYS.targetVersion) || "");
initializeTargetLoaderControl(localStorage.getItem(STORAGE_KEYS.targetLoader) || "fabric");

function selectHasValue(select, value) {
	return [...select.options].some(option => option.value === value)
}

function setCustomInputVisibility(input, visible) {
	input.hidden = !visible
}

function selectedTargetVersion() {
	return targetVersionSelectEl.value === "other" ? targetVersionEl.value.trim() : targetVersionSelectEl.value
}

function selectedTargetLoader() {
	return targetLoaderEl.value === "other" ? targetLoaderCustomEl.value.trim() : targetLoaderEl.value
}

function initializeTargetVersionControl(value) {
	if (value && selectHasValue(targetVersionSelectEl, value)) {
		targetVersionSelectEl.value = value;
		targetVersionEl.value = "";
		setCustomInputVisibility(targetVersionEl, false)
	} else {
		targetVersionSelectEl.value = "other";
		targetVersionEl.value = value;
		setCustomInputVisibility(targetVersionEl, true)
	}
}

function initializeTargetLoaderControl(value) {
	if (value && selectHasValue(targetLoaderEl, value)) {
		targetLoaderEl.value = value;
		targetLoaderCustomEl.value = "";
		setCustomInputVisibility(targetLoaderCustomEl, false)
	} else {
		targetLoaderEl.value = "other";
		targetLoaderCustomEl.value = value;
		setCustomInputVisibility(targetLoaderCustomEl, true)
	}
}

function providerIdentityKeys(item) {
	const modrinthId = item.modrinth?.project?.id || item.modrinth?.version?.project_id || "";
	return modrinthId ? [`modrinth:${modrinthId}`] : []
}

function resetImportCaches() {
	importedHashes.clear();
	importedProviderIds.clear()
}

function addItemToImportCaches(item) {
	if (item.sha1) importedHashes.add(item.sha1);
	for (const key of providerIdentityKeys(item)) importedProviderIds.add(key)
}

function rebuildImportCaches() {
	resetImportCaches();
	for (const item of importedFiles) addItemToImportCaches(item)
}

function filterNewImportedItems(items) {
	const accepted = [];
	for (const item of items) {
		if (item.sha1 && importedHashes.has(item.sha1)) continue;
		const providerKeys = providerIdentityKeys(item);
		if (providerKeys.some(key => importedProviderIds.has(key))) continue;
		accepted.push(item);
		addItemToImportCaches(item)
	}
	return accepted
}

function setTargetAction(action) {
	targetAction = action;
	startSearchEl.textContent = action === "download" ? "Download target version" : "Search for target version"
}

function restoreTargetSearchAction() {
	setTargetAction("search")
}

function clearTargetSearchResults() {
	targetSearched = false;
	for (const item of importedFiles) {
		item.download = null;
		item.downloadError = ""
	}
}

function clearTargetSearchResultsAndRestoreSearchAction() {
	clearTargetSearchResults();
	restoreTargetSearchAction()
}

function preferences() {
	return {
		gameVersion: selectedTargetVersion(),
		loader: selectedTargetLoader(),
		minimumRelease: minimumReleaseEl.value
	}
}

function setBusy(value, message = "") {
	busy = value;
	for (const button of document.querySelectorAll("button")) button.disabled = value;
	statusEl.textContent = message
}

function formatFileSize(bytes) {
	const value = Number(bytes) || 0;
	const units = ["B", "KB", "MB", "GB", "TB"];
	let unitIndex = 0;
	let scaled = value;
	while (unitIndex < units.length - 1 && scaled >= 1024 * .7) {
		scaled /= 1024;
		unitIndex++
	}
	if (unitIndex === 0) return `${value.toLocaleString()} bytes`;
	return `${scaled.toLocaleString(undefined,{maximumFractionDigits:scaled<10?2:1})} ${units[unitIndex]}`
}

function rawFileSizeTitle(bytes) {
	return `${(Number(bytes)||0).toLocaleString()} bytes`
}

function subsequenceMatch(text, query) {
	const source = String(text || "");
	const needle = String(query || "").trim();
	if (!needle) return [];
	const sourceLower = source.toLocaleLowerCase();
	const needleLower = needle.toLocaleLowerCase();
	const indices = [];
	let position = 0;
	for (const character of needleLower) {
		const found = sourceLower.indexOf(character, position);
		if (found === -1) return null;
		indices.push(found);
		position = found + 1
	}
	return indices
}

function compareNumberArrays(left, right) {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index++) {
		if (left[index] !== right[index]) return left[index] - right[index]
	}
	return left.length - right.length
}

function appendHighlightedText(parent, text, indices) {
	const source = String(text || "");
	const matched = new Set(indices || []);
	let buffer = "";
	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		if (matched.has(index)) {
			if (buffer) {
				parent.append(buffer);
				buffer = ""
			}
			const bold = document.createElement("b");
			bold.textContent = character;
			parent.append(bold)
		} else buffer += character
	}
	if (buffer) parent.append(buffer)
}

function originalFound(item) {
	return Boolean(item.modrinth)
}

function targetFound(item) {
	return Boolean(item.download)
}

function syncContentFilterOptions() {
	const hideTargetFilter = !targetSearched;
	targetFilterEl.hidden = hideTargetFilter;
	if (hideTargetFilter && targetFilterEl.value !== "all") targetFilterEl.value = "all"
}

function importedFoundCount() {
	return importedFiles.filter(originalFound).length
}

function importedSummary() {
	return `Found ${importedFoundCount()}/${importedFiles.length} imported files`
}

function targetSummary(found, prefs) {
	const targetLabel = targetVersionLabel(prefs.loader, prefs.gameVersion);
	return `${importedSummary()}. Found target-compatible downloads for ${found}/${importedFiles.length} files using ${targetLabel}.`
}

function normalizedLoaderId(loader) {
	return String(loader || "").trim().toLocaleLowerCase()
}

function normalizedVersionId(version) {
	return String(version || "").trim()
}

function targetVersionLabel(loader, gameVersion) {
	const normalizedLoader = normalizedLoaderId(loader);
	const normalizedGameVersion = normalizedVersionId(gameVersion);
	if (normalizedLoader && normalizedGameVersion) return `${normalizedLoader}-${normalizedGameVersion}`;
	return normalizedGameVersion || normalizedLoader
}

function providerSiteUrl(item) {
	if (item.modrinth?.project?.slug) return `https://modrinth.com/mod/${item.modrinth.project.slug}`;
	return ""
}

function originalProviderRecords(item) {
	const modrinthVersion = item.modrinth?.version;
	if (!modrinthVersion) return [];
	return [{
		provider: "modrinth",
		available: true,
		modVersion: normalizedVersionId(modrinthVersion.version_number || modrinthVersion.name || modrinthVersion.id || ""),
		siteName: item.modrinth?.project?.title || "",
		url: providerSiteUrl(item)
	}]
}

function targetVersionRecords(item) {
	if (!item.download) return [];
	return [{
		provider: "modrinth",
		available: true,
		modVersion: normalizedVersionId(item.download.versionName || ""),
		siteName: item.modrinth?.project?.title || "",
		url: providerSiteUrl(item)
	}]
}

function passesSourceFilter(item) {
	const value = sourceFilterEl.value;
	const hasOriginal = originalFound(item);
	if (value === "found") return hasOriginal;
	if (value === "not-found") return !hasOriginal;
	return true
}

function passesTargetFilter(item) {
	if (!targetSearched) return true;
	const value = targetFilterEl.value;
	if (value === "found") return targetFound(item);
	if (value === "not-found") return !targetFound(item);
	return true
}

function passesContentFilter(item) {
	return passesSourceFilter(item) && passesTargetFilter(item)
}

function displayNameForItem(item) {
	return item.modrinth?.project?.title || ""
}

function descriptionForItem(item) {
	return item.modrinth?.project?.description || ""
}

function iconUrlForItem(item) {
	return item.modrinth?.project?.icon_url || ""
}

function visibleFiles() {
	const query = searchQueryEl.value.trim();
	const visible = [];
	importedFiles.forEach((item, originalIndex) => {
		if (!passesContentFilter(item)) return;
		const displayName = displayNameForItem(item);
		let matchKind = "none";
		let indices = [];
		if (query) {
			const nameMatch = displayName ? subsequenceMatch(displayName, query) : null;
			if (nameMatch) {
				matchKind = "name";
				indices = nameMatch
			} else {
				const fileNameMatch = subsequenceMatch(item.fileName, query);
				if (!fileNameMatch) return;
				matchKind = "file";
				indices = fileNameMatch
			}
		}
		visible.push({
			item,
			originalIndex,
			matchKind,
			indices
		})
	});
	if (query) visible.sort((left, right) => {
		const rank = {
			name: 0,
			file: 1,
			none: 2
		};
		const rankDifference = rank[left.matchKind] - rank[right.matchKind];
		if (rankDifference) return rankDifference;
		const indexDifference = compareNumberArrays(left.indices, right.indices);
		if (indexDifference) return indexDifference;
		return left.originalIndex - right.originalIndex
	});
	return visible
}

function createProviderIcon({
	provider,
	available,
	siteName,
	modVersion,
	url
}) {
	const icon = document.createElement(available && url ? "a" : "span");
	icon.className = `provider-status ${available?"provider-available":"provider-unavailable"}`;
	const title = [siteName, modVersion].filter(Boolean).join(" | ");
	if (title) icon.title = title;
	if (available && url) {
		icon.href = url;
		icon.addEventListener("click", event => {
			event.preventDefault();
			window.electronAPI.openExternal(url)
		})
	}
	return icon
}

function createProviderRow(providers, label = "") {
	const row = document.createElement("div");
	row.className = "provider-row";
	if (label) row.append(`${label}:`);
	const byProvider = new Map((providers || []).map(provider => [provider.provider, provider]));
	row.append(createProviderIcon(byProvider.get("modrinth") || {
		provider: "modrinth",
		available: false,
		siteName: "",
		modVersion: "",
		url: ""
	}));
	return row
}

function showFiles() {
	syncContentFilterOptions();
	operationPanelEl.replaceChildren();
	if (!importedFiles.length) {
		const empty = document.createElement("div");
		empty.className = "empty panel";
		empty.textContent = "No files imported.";
		operationPanelEl.append(empty);
		return
	}
	const files = visibleFiles();
	if (!files.length) {
		const empty = document.createElement("div");
		empty.className = "empty panel";
		empty.textContent = "No matching files.";
		operationPanelEl.append(empty);
		return
	}
	for (const {
			item,
			matchKind,
			indices
		}
		of files) {
		const card = document.createElement("div");
		card.className = "file-card";
		const displayName = displayNameForItem(item);
		const header = document.createElement("div");
		header.className = "file-header";
		const iconUrl = iconUrlForItem(item);
		if (iconUrl) {
			const icon = document.createElement("img");
			icon.className = "file-icon";
			icon.src = iconUrl;
			icon.alt = "";
			header.append(icon)
		}
		const text = document.createElement("div");
		text.className = "file-header-text";
		const title = document.createElement("span");
		title.className = "file-title";
		const name = document.createElement("strong");
		appendHighlightedText(name, displayName || item.fileName, matchKind === "name" || !displayName && matchKind === "file" ? indices : []);
		const muted = document.createElement("span");
		muted.className = "muted";
		const size = document.createElement("span");
		size.title = rawFileSizeTitle(item.size);
		size.textContent = formatFileSize(item.size);
		if (displayName) {
			muted.append(" | ", document.createElement("wbr"));
			appendHighlightedText(muted, item.fileName, matchKind === "file" ? indices : []);
			muted.append(" | ", document.createElement("wbr"), size)
		} else {
			muted.append(" | ", document.createElement("wbr"), size)
		}
		title.append(name, muted);
		text.append(title);
		const description = descriptionForItem(item);
		if (description) {
			const descriptionEl = document.createElement("span");
			descriptionEl.className = "file-description muted";
			descriptionEl.textContent = description;
			text.append(descriptionEl)
		}
		header.append(text);
		card.append(header, createProviderRow(originalProviderRecords(item), "Original version"));
		if (originalFound(item) && targetSearched) card.append(createProviderRow(targetVersionRecords(item), "Target version"));
		if (item.lookupErrors?.length || item.downloadError) {
			const error = document.createElement("div");
			error.className = "error";
			error.textContent = [...item.lookupErrors || [], item.downloadError].filter(Boolean).join("\n");
			card.append(error)
		}
		operationPanelEl.append(card)
	}
}

function saveTargetPreferenceAndClearTargetSearchResults(storageKey, value) {
	localStorage.setItem(storageKey, value);
	clearTargetSearchResultsAndRestoreSearchAction();
	showFiles()
}

function mergeTargetState(reloaded, previousItems) {
	const stateByPath = new Map(previousItems.map(item => [item.path, {
		download: item.download || null,
		downloadError: item.downloadError || ""
	}]));
	return reloaded.map(item => ({
		...item,
		...stateByPath.get(item.path)
	}))
}
targetVersionSelectEl.addEventListener("change", () => {
	setCustomInputVisibility(targetVersionEl, targetVersionSelectEl.value === "other");
	saveTargetPreferenceAndClearTargetSearchResults(STORAGE_KEYS.targetVersion, selectedTargetVersion())
});
targetVersionEl.addEventListener("input", () => saveTargetPreferenceAndClearTargetSearchResults(STORAGE_KEYS.targetVersion, selectedTargetVersion()));
targetLoaderEl.addEventListener("change", () => {
	setCustomInputVisibility(targetLoaderCustomEl, targetLoaderEl.value === "other");
	saveTargetPreferenceAndClearTargetSearchResults(STORAGE_KEYS.targetLoader, selectedTargetLoader())
});
targetLoaderCustomEl.addEventListener("input", () => saveTargetPreferenceAndClearTargetSearchResults(STORAGE_KEYS.targetLoader, selectedTargetLoader()));
minimumReleaseEl.addEventListener("change", () => saveTargetPreferenceAndClearTargetSearchResults(STORAGE_KEYS.minimumRelease, minimumReleaseEl.value));
searchQueryEl.addEventListener("input", showFiles);
sourceFilterEl.addEventListener("change", showFiles);
targetFilterEl.addEventListener("change", showFiles);
async function importPaths(paths) {
	if (!paths.length || busy) return;
	const autoSearchTarget = targetSearched || targetAction === "download";
	setBusy(true, `Importing ${paths.length} files`);
	try {
		const response = await window.electronAPI.importMods({
			paths,
			knownHashes: [...importedHashes],
			knownProviderIds: [...importedProviderIds]
		});
		const added = Array.isArray(response) ? response : response.items || [];
		const addedItems = filterNewImportedItems(added);
		importedFiles.push(...addedItems);
		if (!autoSearchTarget) restoreTargetSearchAction();
		showFiles();
		statusEl.textContent = importedSummary();
		if (autoSearchTarget) await refreshDownloadAvailability({
			preserveBusy: true,
			itemsToCheck: addedItems
		})
	} catch (error) {
		statusEl.textContent = `Import failed: ${error.message}`
	} finally {
		setBusy(false, statusEl.textContent)
	}
}
async function refreshDownloadAvailability({
	preserveBusy = false,
	itemsToCheck = null
} = {}) {
	if (!importedFiles.length || busy && !preserveBusy) return;
	const prefs = preferences();
	if (!prefs.gameVersion) {
		statusEl.textContent = "Target Game Version is required.";
		return
	}
	const itemIndex = new Map(importedFiles.map((item, index) => [item, index]));
	const sourceItems = itemsToCheck || importedFiles;
	const indexedItems = sourceItems.map(item => ({
		item,
		index: itemIndex.get(item)
	})).filter(({
		item,
		index
	}) => index !== undefined && originalFound(item));
	for (const item of importedFiles) {
		if (!originalFound(item)) {
			item.download = null;
			item.downloadError = ""
		}
	}
	if (!indexedItems.length) {
		targetSearched = true;
		setTargetAction("download");
		showFiles();
		statusEl.textContent = targetSummary(importedFiles.filter(targetFound).length, prefs);
		return
	}
	if (preserveBusy) statusEl.textContent = `Fetching status for ${indexedItems.length} files`;
	else setBusy(true, `Fetching status for ${indexedItems.length} files`);
	try {
		const results = await window.electronAPI.checkDownloads({
			items: indexedItems.map(({
				item
			}) => item),
			preferences: prefs,
			useCache: false
		});
		results.forEach((result, resultIndex) => {
			const index = indexedItems[resultIndex].index;
			importedFiles[index].download = result.download;
			importedFiles[index].downloadError = result.modrinthError ? `Modrinth: ${result.modrinthError}` : ""
		});
		targetSearched = true;
		setTargetAction("download");
		showFiles();
		const count = importedFiles.filter(targetFound).length;
		statusEl.textContent = targetSummary(count, prefs)
	} catch (error) {
		statusEl.textContent = `Version check failed: ${error.message}`
	} finally {
		if (!preserveBusy) setBusy(false, statusEl.textContent)
	}
}
importFilesEl.addEventListener("click", async () => importPaths(await window.electronAPI.selectJarFiles()));
importFilesFolderEl.addEventListener("click", async () => importPaths(await window.electronAPI.selectFolderJars()));
clearImportFilesEl.addEventListener("click", () => {
	importedFiles = [];
	targetSearched = false;
	resetImportCaches();
	restoreTargetSearchAction();
	statusEl.textContent = "";
	showFiles()
});
reloadEl.addEventListener("click", async () => {
	if (!importedFiles.length || busy) return;
	const autoSearchTarget = targetAction === "download";
	setBusy(true, `Refreshing status for ${importedFiles.length} files`);
	try {
		const previousItems = importedFiles;
		importedFiles = mergeTargetState(await window.electronAPI.reloadMods({
			items: importedFiles
		}), previousItems);
		rebuildImportCaches();
		restoreTargetSearchAction();
		showFiles();
		statusEl.textContent = importedSummary();
		if (autoSearchTarget) await refreshDownloadAvailability({
			preserveBusy: true
		})
	} catch (error) {
		statusEl.textContent = `Reload failed: ${error.message}`
	} finally {
		setBusy(false, statusEl.textContent)
	}
});
async function downloadTargetVersion() {
	if (!importedFiles.length || busy) return;
	const targetItems = importedFiles.filter(originalFound);
	if (targetAction !== "download" || !targetSearched || !targetItems.length) {
		statusEl.textContent = "Run Search for target version before downloading.";
		return
	}
	const downloads = targetItems.map(item => item.download).filter(Boolean);
	if (!downloads.length) {
		statusEl.textContent = "No compatible downloads for the current target.";
		return
	}
	setBusy(true, `Downloading ${downloads.length} files`);
	try {
		const result = await window.electronAPI.chooseAndSaveDownloads({
			downloads
		});
		if (result.canceled) statusEl.textContent = "Download canceled";
		else {
			const ok = result.results.filter(item => item.ok).length;
			const failed = result.results.length - ok;
			statusEl.textContent = failed ? `Downloaded ${ok} files, ${failed} failed` : `Downloaded ${ok} files`
		}
	} catch (error) {
		statusEl.textContent = `Download failed: ${error.message}`
	} finally {
		setBusy(false, statusEl.textContent)
	}
}
startSearchEl.addEventListener("click", async () => {
	if (!importedFiles.length || busy) return;
	if (targetAction === "download") await downloadTargetVersion();
	else await refreshDownloadAvailability()
});
setTargetAction("search");
showFiles();
