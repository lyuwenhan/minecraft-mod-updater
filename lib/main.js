const searchQueryEl = document.getElementById("search-query");
const sourceFilterEl = document.getElementById("source-filter");
const targetFilterEl = document.getElementById("target-filter");
const operationPanelEl = document.getElementById("operation-panel");
const importFilesEl = document.getElementById("import-files");
const importFilesFolderEl = document.getElementById("import-files-folder");
const clearImportFilesEl = document.getElementById("clear-import-files");
const reloadEl = document.getElementById("reload");
const startSearchEl = document.getElementById("start-search");
const exportSummaryEl = document.getElementById("export-summary");
const targetVersionSelectEl = document.getElementById("target-version-select");
const targetVersionEl = document.getElementById("target-version");
const targetLoaderEl = document.getElementById("target-loader");
const targetLoaderCustomEl = document.getElementById("target-loader-custom");
const minimumReleaseEl = document.getElementById("minimum-release");
const statusEl = document.getElementById("status");
const LYUWENHAN_EXTENSIONS_URL = "https://lyuwenhan.github.io/extensions/minecraft-java";
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
let statusRestoreTimer = null;
minimumReleaseEl.value = localStorage.getItem(STORAGE_KEYS.minimumRelease) || "beta";
const storedTargetVersion = localStorage.getItem(STORAGE_KEYS.targetVersion) || "";
initializeTargetVersionControl(storedTargetVersion);
initializeTargetLoaderControl(localStorage.getItem(STORAGE_KEYS.targetLoader) || "fabric");
loadGameVersions(storedTargetVersion);

function selectHasValue(select, value) {
	return [...select.options].some(option => option.value === value)
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
		targetVersionEl.value = ""
	} else {
		targetVersionSelectEl.value = "other";
		targetVersionEl.value = value
	}
}

function setTargetVersionOptions(versions, preferredValue) {
	const currentValue = typeof preferredValue === "string" ? preferredValue.trim() : "";
	const otherOption = document.createElement("option");
	otherOption.value = "other";
	otherOption.textContent = "Other";
	targetVersionSelectEl.replaceChildren(otherOption);
	const seen = new Set;
	for (const version of versions) {
		if (typeof version !== "string" || !version || seen.has(version)) {
			continue
		}
		seen.add(version);
		const option = document.createElement("option");
		option.value = version;
		option.textContent = version;
		targetVersionSelectEl.append(option)
	}
	if (currentValue) {
		initializeTargetVersionControl(currentValue)
	} else if (targetVersionSelectEl.options.length > 1) {
		targetVersionSelectEl.selectedIndex = 1;
		targetVersionEl.value = "";
		localStorage.setItem(STORAGE_KEYS.targetVersion, selectedTargetVersion())
	} else {
		initializeTargetVersionControl("")
	}
}
async function loadGameVersions(preferredValue) {
	try {
		const versions = await window.electronAPI.getGameVersions();
		setTargetVersionOptions(Array.isArray(versions) ? versions : [], preferredValue)
	} catch (error) {
		setTargetVersionOptions([], preferredValue);
		statusEl.textContent = `Failed to load game versions: ${getUiErrorMessage(error)}`
	}
}

function initializeTargetLoaderControl(value) {
	if (value && selectHasValue(targetLoaderEl, value)) {
		targetLoaderEl.value = value;
		targetLoaderCustomEl.value = ""
	} else {
		targetLoaderEl.value = "other";
		targetLoaderCustomEl.value = value
	}
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

function resetImportCaches() {
	importedHashes.clear();
	importedProviderIds.clear()
}

function addItemToImportCaches(item) {
	if (item.sha1) {
		importedHashes.add(item.sha1)
	}
	for (const key of providerIdentityKeys(item)) {
		importedProviderIds.add(key)
	}
}

function rebuildImportCaches() {
	resetImportCaches();
	for (const item of importedFiles) {
		addItemToImportCaches(item)
	}
}

function removeImportedFileAt(index) {
	const lastIndex = importedFiles.length - 1;
	if (index < 0 || index > lastIndex) {
		return
	}
	if (index !== lastIndex) {
		importedFiles[index] = importedFiles[lastIndex]
	}
	importedFiles.pop()
}

function getUiErrorMessage(error) {
	return error?.message === "Too many requests" ? "Too many requests" : error.message
}

function filterNewImportedItems(items) {
	const accepted = [];
	for (const item of items) {
		if (item.sha1 && importedHashes.has(item.sha1)) {
			continue
		}
		const providerKeys = providerIdentityKeys(item);
		if (providerKeys.some(key => importedProviderIds.has(key))) {
			continue
		}
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
		item.modrinthDownload = null;
		item.curseforgeDownload = null;
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

function summaryExportData() {
	const prefs = preferences();
	const items = importedFiles.map(item => ({
		name: displayNameForItem(item) || "N/A",
		fileName: item.fileName,
		sourceFound: originalFound(item),
		targetFound: targetFound(item),
		url: providerSiteUrl(item)
	}));
	items.sort((left, right) => {
		const leftName = String(left.name || "").trim() || "N/A";
		const rightName = String(right.name || "").trim() || "N/A";
		const leftIsNA = leftName.toLocaleUpperCase() === "N/A";
		const rightIsNA = rightName.toLocaleUpperCase() === "N/A";
		if (leftIsNA !== rightIsNA) {
			return leftIsNA ? -1 : 1
		}
		return leftName.localeCompare(rightName, undefined, {
			sensitivity: "base"
		})
	});
	return {
		targetVersion: prefs.gameVersion,
		targetLoader: prefs.loader,
		items
	}
}

function clearStatusRestoreTimer() {
	if (!statusRestoreTimer) {
		return
	}
	clearTimeout(statusRestoreTimer);
	statusRestoreTimer = null
}

function currentSummaryStatus() {
	if (targetSearched) {
		return targetSummary(importedFiles.filter(targetFound).length, preferences())
	}
	return importedSummary()
}

function restoreStatusAfterDelay(message, delay = 3e3) {
	clearStatusRestoreTimer();
	statusRestoreTimer = setTimeout(() => {
		statusRestoreTimer = null;
		if (statusEl.textContent === message) {
			statusEl.textContent = currentSummaryStatus()
		}
	}, delay)
}

function setBusy(value, message = "") {
	clearStatusRestoreTimer();
	busy = value;
	for (const button of document.querySelectorAll("button")) {
		button.disabled = value
	}
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
	if (unitIndex === 0) {
		return `${value.toLocaleString()} bytes`
	}
	return `${scaled.toLocaleString(undefined,{maximumFractionDigits:scaled<10?2:1})} ${units[unitIndex]}`
}

function rawFileSizeTitle(bytes) {
	return `${(Number(bytes)||0).toLocaleString()} bytes`
}

function subsequenceMatch(text, query) {
	const source = String(text || "");
	const needle = String(query || "").trim();
	if (!needle) {
		return []
	}
	const sourceLower = source.toLocaleLowerCase();
	const needleLower = needle.toLocaleLowerCase();
	const indices = [];
	let position = 0;
	for (const character of needleLower) {
		const found = sourceLower.indexOf(character, position);
		if (found === -1) {
			return null
		}
		indices.push(found);
		position = found + 1
	}
	return indices
}

function compareNumberArrays(left, right) {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index++) {
		if (left[index] !== right[index]) {
			return left[index] - right[index]
		}
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
		} else {
			buffer += character
		}
	}
	if (buffer) {
		parent.append(buffer)
	}
}

function originalFound(item) {
	return Boolean(item.lyuwenhanExtensions || item.modrinth || item.curseforge)
}

function targetFound(item) {
	return Boolean(item.download)
}

function syncContentFilterOptions() {
	const hideTargetFilter = !targetSearched;
	targetFilterEl.hidden = hideTargetFilter;
	if (hideTargetFilter && targetFilterEl.value !== "all") {
		targetFilterEl.value = "all"
	}
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
	if (normalizedLoader && normalizedGameVersion) {
		return `${normalizedLoader}-${normalizedGameVersion}`
	}
	return normalizedGameVersion || normalizedLoader
}

function firstLyuwenhanExtensionsLink(item) {
	const links = item.lyuwenhanExtensions?.link;
	if (!links || typeof links !== "object" || Array.isArray(links)) {
		return ""
	}
	for (const value of Object.values(links)) {
		if (typeof value === "string" && value) {
			return value
		}
	}
	return ""
}

function curseForgeSiteUrl(item) {
	return item.curseforge?.mod?.links?.websiteUrl || (item.curseforge?.mod?.slug ? `https://www.curseforge.com/minecraft/mc-mods/${item.curseforge.mod.slug}` : "")
}

function providerSiteUrl(item) {
	if (item.lyuwenhanExtensions) {
		return firstLyuwenhanExtensionsLink(item) || LYUWENHAN_EXTENSIONS_URL
	}
	if (item.modrinth?.project?.slug) {
		return `https://modrinth.com/mod/${item.modrinth.project.slug}`
	}
	return curseForgeSiteUrl(item)
}

function originalProviderRecords(item) {
	if (item.lyuwenhanExtensions) {
		return [{
			provider: "lyuwenhan",
			iconClass: "provider-icon-lyuwenhan",
			available: true,
			modVersion: normalizedVersionId(item.lyuwenhanExtensions.version || ""),
			siteName: item.lyuwenhanExtensions.displayName || "",
			url: providerSiteUrl(item)
		}]
	}
	const modrinthVersion = item.modrinth?.version;
	return [{
		provider: "modrinth",
		iconClass: "provider-icon-modrinth",
		available: Boolean(modrinthVersion),
		modVersion: normalizedVersionId(modrinthVersion?.version_number || modrinthVersion?.name || modrinthVersion?.id || ""),
		siteName: item.modrinth?.project?.title || "",
		url: item.modrinth?.project?.slug ? `https://modrinth.com/mod/${item.modrinth.project.slug}` : ""
	}, {
		provider: "curseforge",
		iconClass: "provider-icon-curseforge",
		available: Boolean(item.curseforge),
		modVersion: normalizedVersionId(item.curseforge?.file?.displayName || item.curseforge?.file?.fileName || ""),
		siteName: item.curseforge?.mod?.name || "",
		url: curseForgeSiteUrl(item)
	}]
}

function targetVersionRecords(item) {
	if (item.lyuwenhanExtensions) {
		return [{
			provider: "lyuwenhan",
			iconClass: "provider-icon-lyuwenhan",
			available: Boolean(item.download),
			modVersion: normalizedVersionId(item.download?.versionName || ""),
			siteName: item.lyuwenhanExtensions.displayName || "",
			url: providerSiteUrl(item)
		}]
	}
	const modrinthDownload = item.modrinthDownload || (item.download?.provider === "modrinth" ? item.download : null);
	const curseforgeDownload = item.curseforgeDownload || (item.download?.provider === "curseforge" ? item.download : null);
	return [{
		provider: "modrinth",
		iconClass: "provider-icon-modrinth",
		available: Boolean(modrinthDownload),
		modVersion: normalizedVersionId(modrinthDownload?.versionName || ""),
		siteName: item.modrinth?.project?.title || "",
		url: providerSiteUrl(item)
	}, {
		provider: "curseforge",
		iconClass: "provider-icon-curseforge",
		available: Boolean(curseforgeDownload),
		modVersion: normalizedVersionId(curseforgeDownload?.versionName || ""),
		siteName: item.curseforge?.mod?.name || "",
		url: curseForgeSiteUrl(item)
	}]
}

function passesSourceFilter(item) {
	const value = sourceFilterEl.value;
	const hasOriginal = originalFound(item);
	if (value === "found") {
		return hasOriginal
	}
	if (value === "not-found") {
		return !hasOriginal
	}
	return true
}

function passesTargetFilter(item) {
	if (!targetSearched) {
		return true
	}
	const value = targetFilterEl.value;
	if (value === "found") {
		return targetFound(item)
	}
	if (value === "not-found") {
		return !targetFound(item)
	}
	return true
}

function passesContentFilter(item) {
	return passesSourceFilter(item) && passesTargetFilter(item)
}

function displayNameForItem(item) {
	return item.lyuwenhanExtensions?.displayName || item.modrinth?.project?.title || item.curseforge?.mod?.name || ""
}

function descriptionForItem(item) {
	return item.lyuwenhanExtensions?.description || item.modrinth?.project?.description || item.curseforge?.mod?.summary || ""
}

function iconUrlForItem(item) {
	if (item.lyuwenhanExtensions) {
		return item.lyuwenhanExtensions.hasIcon ? item.lyuwenhanExtensions.iconUrl || "" : ""
	}
	return item.modrinth?.project?.icon_url || item.curseforge?.mod?.logo?.thumbnailUrl || item.curseforge?.mod?.logo?.url || ""
}

function visibleFiles() {
	const query = searchQueryEl.value.trim();
	const visible = [];
	importedFiles.forEach((item, originalIndex) => {
		if (!passesContentFilter(item)) {
			return
		}
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
				if (!fileNameMatch) {
					return
				}
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
	if (query) {
		visible.sort((left, right) => {
			const rank = {
				name: 0,
				file: 1,
				none: 2
			};
			const rankDifference = rank[left.matchKind] - rank[right.matchKind];
			if (rankDifference) {
				return rankDifference
			}
			const indexDifference = compareNumberArrays(left.indices, right.indices);
			if (indexDifference) {
				return indexDifference
			}
			return left.originalIndex - right.originalIndex
		})
	}
	return visible
}

function createProviderIcon({
	provider,
	iconClass,
	available,
	siteName,
	modVersion,
	url
}) {
	const icon = document.createElement("a");
	icon.className = `provider-status ${iconClass} ${available?"provider-available":"provider-unavailable"}`;
	const title = [siteName, modVersion].filter(Boolean).join(" | ");
	if (title) {
		icon.title = title
	}
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
	if (label) {
		row.append(`${label}:`)
	}
	for (const provider of providers || []) {
		row.append(createProviderIcon(provider))
	}
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
		if (originalFound(item) && targetSearched) {
			card.append(createProviderRow(targetVersionRecords(item), "Target version"))
		}
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
		modrinthDownload: item.modrinthDownload || null,
		curseforgeDownload: item.curseforgeDownload || null,
		downloadError: item.downloadError || ""
	}]));
	const reloadedByPath = new Map(reloaded.map(item => [item.path, item]));
	let index = 0;
	while (index < importedFiles.length) {
		if (!reloadedByPath.has(importedFiles[index].path)) {
			removeImportedFileAt(index);
			continue
		}
		index++
	}
	return importedFiles.map(item => ({
		...reloadedByPath.get(item.path),
		...stateByPath.get(item.path)
	}))
}
targetVersionSelectEl.addEventListener("change", () => {
	saveTargetPreferenceAndClearTargetSearchResults(STORAGE_KEYS.targetVersion, selectedTargetVersion())
});
targetVersionEl.addEventListener("input", () => {
	saveTargetPreferenceAndClearTargetSearchResults(STORAGE_KEYS.targetVersion, selectedTargetVersion())
});
targetLoaderEl.addEventListener("change", () => {
	saveTargetPreferenceAndClearTargetSearchResults(STORAGE_KEYS.targetLoader, selectedTargetLoader())
});
targetLoaderCustomEl.addEventListener("input", () => {
	saveTargetPreferenceAndClearTargetSearchResults(STORAGE_KEYS.targetLoader, selectedTargetLoader())
});
minimumReleaseEl.addEventListener("change", () => {
	saveTargetPreferenceAndClearTargetSearchResults(STORAGE_KEYS.minimumRelease, minimumReleaseEl.value)
});
searchQueryEl.addEventListener("input", showFiles);
sourceFilterEl.addEventListener("change", showFiles);
targetFilterEl.addEventListener("change", showFiles);
async function importPaths(paths) {
	if (!paths.length || busy) {
		return
	}
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
		if (!autoSearchTarget) {
			restoreTargetSearchAction()
		}
		showFiles();
		statusEl.textContent = importedSummary();
		if (autoSearchTarget) {
			await refreshDownloadAvailability({
				preserveBusy: true,
				itemsToCheck: addedItems
			})
		}
	} catch (error) {
		statusEl.textContent = `Import failed: ${getUiErrorMessage(error)}`
	} finally {
		setBusy(false, statusEl.textContent)
	}
}
async function refreshDownloadAvailability({
	preserveBusy = false,
	itemsToCheck = null
} = {}) {
	if (!importedFiles.length || busy && !preserveBusy) {
		return
	}
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
			item.modrinthDownload = null;
			item.curseforgeDownload = null;
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
	if (preserveBusy) {
		statusEl.textContent = `Fetching status for ${indexedItems.length} files`
	} else {
		setBusy(true, `Fetching status for ${indexedItems.length} files`)
	}
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
			importedFiles[index].modrinthDownload = result.modrinthDownload || null;
			importedFiles[index].curseforgeDownload = result.curseforgeDownload || null;
			importedFiles[index].downloadError = result.downloadError || (result.modrinthError ? `Modrinth: ${result.modrinthError}` : "") || (result.curseforgeError ? `CurseForge: ${result.curseforgeError}` : "")
		});
		targetSearched = true;
		setTargetAction("download");
		showFiles();
		const count = importedFiles.filter(targetFound).length;
		statusEl.textContent = targetSummary(count, prefs)
	} catch (error) {
		statusEl.textContent = `Version check failed: ${getUiErrorMessage(error)}`
	} finally {
		if (!preserveBusy) {
			setBusy(false, statusEl.textContent)
		}
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
	if (!importedFiles.length || busy) {
		return
	}
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
		if (autoSearchTarget) {
			await refreshDownloadAvailability({
				preserveBusy: true
			})
		}
	} catch (error) {
		statusEl.textContent = `Reload failed: ${getUiErrorMessage(error)}`
	} finally {
		setBusy(false, statusEl.textContent)
	}
});
async function downloadTargetVersion() {
	if (!importedFiles.length || busy) {
		return
	}
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
	let restoreAfterDownload = false;
	try {
		const result = await window.electronAPI.chooseAndSaveDownloads({
			downloads
		});
		if (result.canceled) {
			statusEl.textContent = "Download canceled"
		} else {
			const ok = result.results.filter(item => item.ok).length;
			const failed = result.results.length - ok;
			statusEl.textContent = failed ? `Downloaded ${ok} files, ${failed} failed` : `Downloaded ${ok} files`
		}
		restoreAfterDownload = true
	} catch (error) {
		statusEl.textContent = `Download failed: ${getUiErrorMessage(error)}`
	} finally {
		const finalStatus = statusEl.textContent;
		setBusy(false, finalStatus);
		if (restoreAfterDownload) {
			restoreStatusAfterDelay(finalStatus)
		}
	}
}
exportSummaryEl.addEventListener("click", async () => {
	if (!importedFiles.length || busy) {
		return
	}
	if (!targetSearched) {
		await refreshDownloadAvailability();
		if (!targetSearched) {
			return
		}
	}
	setBusy(true, "Exporting summary");
	try {
		const result = await window.electronAPI.exportSummary(summaryExportData());
		statusEl.textContent = result.canceled ? "Export canceled" : "Summary exported"
	} catch (error) {
		statusEl.textContent = `Export failed: ${getUiErrorMessage(error)}`
	} finally {
		setBusy(false, statusEl.textContent)
	}
});
startSearchEl.addEventListener("click", async () => {
	if (!importedFiles.length || busy) {
		return
	}
	if (targetAction === "download") {
		await downloadTargetVersion()
	} else {
		await refreshDownloadAvailability()
	}
});
setTargetAction("search");
showFiles();
