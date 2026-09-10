# scripts/

## `deploy-poll.ps1` — pull-based deploy for the panel box

Keeps the box's checkout in step with a branch on GitHub. Runs **on the
box**; nothing inbound is exposed.

```
git fetch  ->  is Minecraft idle?  ->  stop panel  ->  reset --hard  ->  start panel  ->  verify /api/version
```

### Why polling and not a webhook

A webhook listener means an inbound port on a public hostname, and a
"stop, pull, start" endpoint is a remote-code-execution primitive by
design — its safety rests on getting HMAC verification right *and* never
pulling a ref the payload names. Polling has none of that surface: no
port, no secret, nothing that has to stay correct. The cost is latency up
to one poll interval.

Hiding the script wouldn't have helped a listener either. Attackers find
open ports by scanning, not by reading the repo. That's why this file is
public and only `deploy.config.json` is not.

### Setup

1. Copy `deploy.config.example.json` to `deploy.config.json` and fill it
   in. It's gitignored — it holds the panel account's password.
   - Use a dedicated panel account with `kill` (needed only for `-Force`).
   - Point `panelUrl` at `http://localhost:<port>`; no reason to go out
     through Caddy and back.
2. Try it by hand first: `-WhatIf` reports what it would do, `-Loop`
   watches continuously.
3. Register it with Task Scheduler — see the second `.EXAMPLE` in
   `Get-Help .\deploy-poll.ps1 -Full`.

### It will not deploy while Minecraft is running

By design. Restarting the panel mid-session orphans the Minecraft child
process (the panel's handle on it lives only in memory), and a hard kill
risks the world save. When the server is up it logs and exits; the next
run tries again. `-Force` overrides, stopping Minecraft gracefully
through the API first.

### Reading the log

`deploy.log` beside the script (gitignored), or wherever `logPath` points.

```
[2026-09-10 13:32:04] INFO  origin/master moved: 7247a0f -> ab03607.
[2026-09-10 13:32:07] INFO  Stopping panel (PID 16656).
[2026-09-10 13:32:09] INFO  Checkout now at ab03607.
[2026-09-10 13:32:11] INFO  Deployed. Panel version: 40dcf9e39329.
```

That last line is the same fingerprint `panel-version.setup.ts` asserts
against, so a successful deploy and a green test suite agree on what's
live. `Panel version unchanged` means either the change touched no panel
source or the restart didn't take.
