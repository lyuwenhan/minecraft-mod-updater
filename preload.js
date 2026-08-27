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
	chooseAndSaveDownloads: payload => ipcRenderer.invoke("downloads:choose-and-save", payload),
	exportSummary: payload => ipcRenderer.invoke("summary:export", payload),
	openExternal: url => ipcRenderer.invoke("shell:open-external", url)
});
