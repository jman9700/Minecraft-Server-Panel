# Demo media

Drop screenshots here and they appear in the panel's **Demo** tab as a
gallery. Supported today: `.png`, `.jpg`, `.jpeg`.

Files are sorted by name using natural ordering, so a numeric prefix is
all you need to control the sequence:

    01-spawn.png
    02-base.png
    10-nether.png

Sources can be full resolution; the gallery scales them to fit and only
loads thumbnails lazily.

## Two things worth knowing

**This directory is not public.** It used to sit under `public/`, which
the panel serves without authentication — meaning anyone with a URL could
fetch these images without an account. It now lives outside `public/` and
is served through an authenticated route behind the `view_demo`
permission.

**These files are not gitignored.** Committing them means the demo works
on a fresh deploy; leaving them uncommitted keeps the repo small and they
survive deploys anyway, since `git reset --hard` does not remove
untracked files. Your call — the deploy poller is happy either way.

To point the gallery somewhere else entirely, set `demoDir` in
`config.json` to an absolute path.

## Roadmap

Video is next (`.mp4` / `.webm`); the listing endpoint already tags each
item with a `type`, and `express.static` already serves the range
requests video seeking needs.
