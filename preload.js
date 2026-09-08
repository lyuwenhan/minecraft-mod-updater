const {
	contextBridge,
	ipcRenderer
} = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
	selectJarFiles: () => ipcRenderer.invoke("files:select"),
	selectFolderJars: () => ipcRenderer.invoke("folder:select-jars"),
	importMods: payload => ipcRenderer.invoke("mods:import", payload),
	reloadMods: payload => ipcRenderer.invoke("mods:reload", payload),
	checkDownloads: payload => ipcRenderer.invoke("mods:check-downloads", payload),
	getGameVersions: () => ipcRenderer.invoke("modrinth:game-versions"),
	checkForUpdates: () => ipcRenderer.invoke("updates:check"),
	getSettings: () => ipcRenderer.invoke("settings:get"),
	setSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),
	getSourcePreferences: () => ipcRenderer.invoke("settings:get-source-preferences"),
	setSourcePreference: (key, value) => ipcRenderer.invoke("settings:set-source-preference", key, value),
	chooseAndSaveDownloads: payload => ipcRenderer.invoke("downloads:choose-and-save", payload),
	exportSummary: payload => ipcRenderer.invoke("summary:export", payload),
	openExternal: url => ipcRenderer.invoke("shell:open-external", url)
});
