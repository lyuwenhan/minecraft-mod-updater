# Minecraft Mod Updater

Minecraft Mod Updater helps you quickly find and download compatible versions of your Minecraft mods when moving to a different Minecraft version or mod loader.

Instead of checking every mod manually, import your existing mods, choose your target setup, and let Minecraft Mod Updater find available versions for you.

## Features

- Import individual mod files
- Import all mod files from a folder
- Automatically identify supported mods from [Modrinth](https://modrinth.com), [CurseForge](https://www.curseforge.com/minecraft), and [lyuwenhan/minecraft-java-edition-mods](https://github.com/lyuwenhan/minecraft-java-edition-mods)
- Search for versions compatible with your target Minecraft version
- Support Fabric, Forge, NeoForge, Quilt, and other available loaders
- Choose between release, beta, and alpha versions
- Quickly see which mods have compatible versions available
- Search and filter large mod lists
- Open mod project pages for additional information
- Download compatible versions in one operation
- Export search results to an Excel workbook
- Filter exported results by availability
- Remember recently used folders
- Automatically check for application updates with options to update now, update later, or skip a version

## Supported Mod Sources

Minecraft Mod Updater can identify and search mods from:

- [lyuwenhan/minecraft-java-edition-mods](https://github.com/lyuwenhan/minecraft-java-edition-mods)
- [Modrinth](https://modrinth.com)
- [CurseForge](https://www.curseforge.com/minecraft/mc-mods)

## Supported Platforms

Minecraft Mod Updater is available for:

- Windows
- macOS
- Linux

Available download formats may vary by platform.

Automatic updates are supported by the installed version, while the portable version must be updated manually.

## How to Use

### 1. Import your mods

Choose **Import files** to select individual mod files, or **Import files from folder** to load all mod files from a folder.

Minecraft Mod Updater will identify the imported mods and display the available information for each one.

### 2. Choose your target setup

Select:

- **Target Game Version** - the Minecraft version you want to use
- **Target Loader** - Fabric, Forge, NeoForge, Quilt, or another available loader
- **Minimum Release Level** - choose whether release, beta, or alpha versions may be included

### 3. Search for compatible versions

Click **Search for target version**.

Minecraft Mod Updater will check your imported mods and show which ones have versions available for your selected setup.

### 4. Review the results

You can quickly see which mods:

- Were identified successfully
- Have a compatible version available
- Do not have a compatible version available
- Could not be identified

Use the built-in search and filters to find specific mods or narrow down the results.

### 5. Download

Once the search is complete, click **Download target version** and choose where you want to save the files.

Only mods with a compatible version available will be downloaded.

If the selected download folder is not empty, Minecraft Mod Updater will ask for confirmation before continuing.

For safety, it is recommended to download into a separate folder instead of directly replacing your existing mods.

### 6. Export a summary

Click **Export summary** to save the current results as an Excel workbook.

If a search has not been performed yet, Minecraft Mod Updater will run it before exporting.

The exported summary includes:

- Target Minecraft version
- Target loader
- Mod name
- Original JAR file name
- Whether the mod was identified
- Whether a compatible target version was found
- Links to available project pages

Mods that could not be identified are shown as **N/A**.

## Finding Mods

For larger mod collections, use the built-in search and filters to quickly find:

- Mods with compatible target versions
- Mods without a compatible target version
- Mods that could not be identified
- A specific mod by name
- A specific mod by file name

This makes it easier to review large modpacks and find the mods that still need attention.

## Automatic Updates

Supported installed versions of Minecraft Mod Updater automatically check for newer application releases.

When a new version is available, you can choose to:

- Update now
- Update later
- Skip the current version

If you choose **Update now**, Minecraft Mod Updater will download the update and install it automatically.

If you choose **Update later**, you can continue using the current version and will be prompted again later.

If you choose **Skip this version**, that version will no longer be shown, but newer versions will still be offered when available.

The portable version does not update itself automatically.

## Notes

Minecraft Mod Updater can only provide versions that are available from supported mod sources, including [Modrinth](https://modrinth.com), [CurseForge](https://www.curseforge.com/minecraft/mc-mods),  and [lyuwenhan/minecraft-java-edition-mods](https://github.com/lyuwenhan/minecraft-java-edition-mods).

Some mods may not be identified or may not have a version compatible with your selected:

- Minecraft version
- Mod loader
- Release level

A compatible version being available does not guarantee that every mod in a modpack will work together.

Some mods may also require:

- Additional dependencies
- Configuration changes
- Different versions of related mods
- Manual compatibility adjustments

## Recommended Use

When updating a large modpack:

1. Back up your current Minecraft instance.
2. Import your existing mods.
3. Choose the target Minecraft version and loader.
4. Search for compatible versions.
5. Review mods that could not be identified.
6. Review mods without a compatible target version.
7. Export a summary if needed.
8. Download the available versions into a separate folder.
9. Test the updated mods in a separate Minecraft instance.

## Troubleshooting

### A mod is shown as N/A

Minecraft Mod Updater could not identify the mod.

This may happen if the mod is not available from a supported source or if the exact file cannot be recognized.

### No compatible version is found

Check that the correct Minecraft version, loader, and release level are selected.

The mod may not have a compatible version available yet.

### A download fails

Check your internet connection and try again.

The file may also be temporarily unavailable from its source.

### Automatic updates do not appear

Make sure:

- You are using an installed version that supports automatic updates
- A newer Minecraft Mod Updater version has actually been released
- Your internet connection can access GitHub
- The available version has not previously been skipped

The Windows portable version does not update automatically.

## Important

Always back up your Minecraft instance or mods folder before making major changes to a modpack.

Minecraft Mod Updater helps you find available versions, but it cannot guarantee that all mods will be compatible with each other after an update.

## Disclaimer

Minecraft Mod Updater is not affiliated with or endorsed by Mojang Studios, Microsoft, Modrinth, CurseForge, Overwolf, or individual mod authors unless explicitly stated otherwise.

Minecraft is a trademark of Microsoft and/or Mojang Studios.
