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
players build a profile that will not connect — so the Modpack tab shows
a drift verdict beside each pack.

The check is **timestamps**: any `.jar` in the server's `mods/` modified
after the pack was exported means the pack is behind, and the changed
filenames are listed so you know what moved.

It deliberately does not compare mod lists. A pack carries client-only
mods (shaders, Distant Horizons) the server never has, and the server can
carry server-only mods absent from the pack, so the two counts differ in
normal operation. Both counts are shown as context, but they never decide
the verdict — otherwise it would cry wolf constantly.

If the panel cannot read `mods/` it says so rather than implying the pack
is fine.

Set `packDir` in `config.json` to host exports from somewhere else.
