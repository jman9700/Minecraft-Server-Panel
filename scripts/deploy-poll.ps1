<#
.SYNOPSIS
    Pull-based deploy for the Minecraft panel. Run on the box itself.

.DESCRIPTION
    Checks whether the tracked branch has moved on the remote and, if so,
    restarts the panel onto the new code:

        fetch -> is Minecraft idle? -> stop panel -> reset --hard -> start panel -> verify

    Deliberately pull-based. There is no inbound port, no listener and no
    webhook secret, so nothing here is sensitive and nothing needs to be
    stripped before the repo goes public. The box reaches out; nothing
    reaches in.

    It will NOT deploy while the Minecraft server is running or starting --
    it logs and exits, and the next scheduled run tries again. Restarting
    the panel mid-session would orphan the Minecraft child process (the
    panel's handle on it lives only in memory) and a hard kill risks the
    world save. Pass -Force to override, which stops Minecraft gracefully
    through the API first.

.PARAMETER ConfigPath
    Defaults to deploy.config.json beside this script. See
    deploy.config.example.json.

.PARAMETER Once
    Default. Check once and exit -- Task Scheduler supplies the interval.

.PARAMETER Loop
    Poll continuously instead, using pollSeconds from the config. Handy
    for watching it work; Task Scheduler is the better production shape.

.PARAMETER Force
    Deploy even if Minecraft is up, stopping it gracefully via the API
    first.

.PARAMETER WhatIf
    Report what would happen without touching anything.

.EXAMPLE
    # One-off check (what Task Scheduler runs)
    powershell -ExecutionPolicy Bypass -File C:\path\to\Minecraft-Server-Panel\scripts\deploy-poll.ps1

.EXAMPLE
    # Register it to run every 2 minutes
    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\path\to\Minecraft-Server-Panel\scripts\deploy-poll.ps1'
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes 2)
    Register-ScheduledTask -TaskName 'MCPanel Deploy Poll' -Action $action -Trigger $trigger
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ConfigPath,
    [switch]$Once,
    [switch]$Loop,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir 'deploy.config.json' }

# ── Config ──────────────────────────────────────────────────
if (-not (Test-Path $ConfigPath)) {
    throw "No config at $ConfigPath. Copy deploy.config.example.json to deploy.config.json and fill it in (it is gitignored)."
}
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json

foreach ($required in @('repoPath', 'panelDir', 'branch', 'panelUrl')) {
    if (-not $cfg.$required) { throw "deploy.config.json is missing '$required'." }
}

$logPath = Join-Path $scriptDir 'deploy.log'
if ($cfg.logPath) { $logPath = $cfg.logPath }

$pollSeconds = 120
if ($cfg.pollSeconds) { $pollSeconds = [int]$cfg.pollSeconds }

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "[{0}] {1,-5} {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    Add-Content -Path $logPath -Value $line -Encoding utf8
}

# ── Panel API helpers ───────────────────────────────────────
function Get-PanelToken {
    if (-not $cfg.username -or -not $cfg.password) { return $null }
    try {
        $body = @{ username = $cfg.username; password = $cfg.password } | ConvertTo-Json
        $res = Invoke-RestMethod -Method Post -Uri "$($cfg.panelUrl)/api/login" `
            -ContentType 'application/json' -Body $body -TimeoutSec 15
        return $res.token
    } catch {
        Write-Log "Could not log in to the panel: $($_.Exception.Message)" 'WARN'
        return $null
    }
}

function Get-PanelJson {
    param([string]$Path, [string]$Token)
    try {
        return Invoke-RestMethod -Method Get -Uri "$($cfg.panelUrl)$Path" `
            -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 15
    } catch {
        return $null
    }
}

function Get-MinecraftStatus {
    param([string]$Token)
    $status = Get-PanelJson -Path '/api/status' -Token $Token
    if ($null -eq $status) { return 'unknown' }
    return $status.status
}

function Stop-Minecraft {
    param([string]$Token)
    Write-Log 'Stopping the Minecraft server via the panel API...'
    try {
        Invoke-RestMethod -Method Post -Uri "$($cfg.panelUrl)/api/server/stop" `
            -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 15 | Out-Null
    } catch {
        Write-Log "Stop request failed: $($_.Exception.Message)" 'WARN'
    }
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        if ((Get-MinecraftStatus -Token $Token) -eq 'stopped') {
            Write-Log 'Minecraft stopped.'
            return $true
        }
        Start-Sleep -Seconds 3
    }
    Write-Log 'Minecraft did not stop within 120s.' 'ERROR'
    return $false
}

# ── Panel process control ───────────────────────────────────
function Get-PanelProcess {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -Verbose:$false |
        Where-Object { $_.CommandLine -and $_.CommandLine -like '*server.js*' }
}

function Stop-Panel {
    $procs = @(Get-PanelProcess)
    if ($procs.Count -eq 0) {
        Write-Log 'Panel was not running.'
        return
    }
    foreach ($p in $procs) {
        Write-Log "Stopping panel (PID $($p.ProcessId))."
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

function Start-Panel {
    Write-Log "Starting panel in $($cfg.panelDir)."
    Start-Process -FilePath 'node' -ArgumentList 'server.js' `
        -WorkingDirectory $cfg.panelDir -WindowStyle Hidden | Out-Null

    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        if (@(Get-PanelProcess).Count -gt 0) {
            try {
                Invoke-WebRequest -Uri "$($cfg.panelUrl)/" -TimeoutSec 5 -UseBasicParsing | Out-Null
                Write-Log 'Panel is answering.'
                return $true
            } catch { }
        }
    }
    Write-Log 'Panel did not come back within 60s.' 'ERROR'
    return $false
}

# ── One deploy check ────────────────────────────────────────
function Invoke-DeployCheck {
    Push-Location $cfg.repoPath
    try {
        git fetch origin --quiet
        if ($LASTEXITCODE -ne 0) { Write-Log 'git fetch failed.' 'ERROR'; return }

        # --verify --quiet: prints nothing and exits non-zero when the ref
        # is missing. Plain `rev-parse` echoes its argument back on stdout
        # instead, which would carry a non-SHA into `git reset --hard`
        # below -- do not "simplify" this away. And no `2>$null`: in PS 5.1
        # redirecting a native command's stderr raises NativeCommandError,
        # which $ErrorActionPreference='Stop' turns into a hard abort
        # before we can log anything useful.
        $local = (git rev-parse --verify --quiet HEAD | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $local -notmatch '^[0-9a-f]{40}$') {
            Write-Log "Could not resolve HEAD in $($cfg.repoPath) -- is it a git checkout?" 'ERROR'
            return
        }

        $remote = (git rev-parse --verify --quiet "origin/$($cfg.branch)" | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $remote -notmatch '^[0-9a-f]{40}$') {
            Write-Log "origin/$($cfg.branch) does not exist on the remote. Check 'branch' in the config." 'ERROR'
            return
        }

        if ($local -eq $remote) {
            Write-Verbose "Up to date at $($local.Substring(0,7))."
            return
        }

        Write-Log "origin/$($cfg.branch) moved: $($local.Substring(0,7)) -> $($remote.Substring(0,7))."

        $token = Get-PanelToken
        $mc = 'unknown'
        if ($token) { $mc = Get-MinecraftStatus -Token $token }

        if ($mc -eq 'running' -or $mc -eq 'starting') {
            if (-not $Force) {
                Write-Log "Minecraft is '$mc' -- deferring. Will retry next run (or use -Force)." 'WARN'
                return
            }
            if (-not $token) { Write-Log 'Cannot stop Minecraft without credentials in the config.' 'ERROR'; return }
            if (-not (Stop-Minecraft -Token $token)) { return }
        } elseif ($mc -eq 'unknown') {
            Write-Log 'Could not read Minecraft status (no credentials, or panel down). Continuing.' 'WARN'
        }

        $versionBefore = $null
        if ($token) {
            $v = Get-PanelJson -Path '/api/version' -Token $token
            if ($v) { $versionBefore = $v.version }
        }

        if (-not $PSCmdlet.ShouldProcess("panel at $($cfg.repoPath)", "deploy $($remote.Substring(0,7))")) {
            Write-Log 'WhatIf: would stop the panel, reset --hard, and restart.'
            return
        }

        Stop-Panel

        git reset --hard $remote --quiet
        if ($LASTEXITCODE -ne 0) {
            Write-Log 'git reset --hard failed. Restarting the panel on the OLD code.' 'ERROR'
            Start-Panel | Out-Null
            return
        }
        Write-Log "Checkout now at $($remote.Substring(0,7))."

        if (-not (Start-Panel)) { return }

        # Close the loop: the panel fingerprints its own source at boot, so
        # a changed /api/version proves the new code is actually live --
        # this is the same value panel-version.setup.ts asserts against.
        $token = Get-PanelToken
        if ($token) {
            $v = Get-PanelJson -Path '/api/version' -Token $token
            if ($v) {
                if ($versionBefore -and $versionBefore -eq $v.version) {
                    Write-Log "Panel version unchanged ($($v.version)) -- no panel source in this change, or the restart did not take." 'WARN'
                } else {
                    Write-Log "Deployed. Panel version: $($v.version)."
                }
            }
        }
        Write-Log "Deploy complete at $($remote.Substring(0,7))."
    } finally {
        Pop-Location
    }
}

# ── Entry point ─────────────────────────────────────────────
if ($Loop) {
    Write-Log "Polling origin/$($cfg.branch) every ${pollSeconds}s. Ctrl+C to stop."
    while ($true) {
        try { Invoke-DeployCheck } catch { Write-Log "Unhandled: $($_.Exception.Message)" 'ERROR' }
        Start-Sleep -Seconds $pollSeconds
    }
} else {
    Invoke-DeployCheck
}
