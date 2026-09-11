# Modpack exports

Put the CurseForge export `.zip` here and it appears in the panel's
**Modpack** tab for download.

To produce one: in the CurseForge app, open the profile, then
**... → Export Profile**. The result is manifest-only — a list of
project/file IDs plus your config overrides, no mod jars — which is why
it is a couple of hundred KB rather than gigabytes, and why sharing it is
fine. The CurseForge client resolves the IDs and downloads the mods.

Downloads are behind the `download_pack` permission and require a panel
account. Unlike demo media this directory is *not* under `public/`, so
nothing here is reachable without logging in.

The panel reads `manifest.json` out of the zip to show the Minecraft
version, loader and mod count beside the download.

## Keep it current

This is a snapshot. If the server's mods change and this zip does not,
players build a profile that will not connect. Re-export after any mod
change. The panel does not yet detect that drift.

Set `packDir` in `config.json` to host exports from somewhere else.
