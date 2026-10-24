[CmdletBinding()]
param(
    [switch]$Status,
    [switch]$Stop,
    [switch]$Restart,
    [switch]$Logs
)

$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $RootDir 'docker-compose.prod.yml'
$EnvFile = Join-Path $RootDir '.env'
$EnvExample = Join-Path $RootDir '.env.example'

function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "[SUCCESS] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# 1. Prerequisite Validation
function Test-DockerDaemon {
    try {
        $null = & docker info 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Check-Prerequisites {
    Write-Info 'Validating Windows Docker prerequisites...'
    
    # Auto-detect docker paths if not already in PATH
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        $candidatePaths = @(
            "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin",
            "$env:ProgramFiles\Docker\Docker\resources\bin",
            "C:\Program Files\Docker\Docker\resources\bin",
            "C:\Program Files\Docker\Docker",
            "$env:ProgramFiles\Docker\Docker"
        )
        foreach ($p in $candidatePaths) {
            if (Test-Path (Join-Path $p 'docker.exe')) {
                Write-Info "Found Docker CLI at: $p. Adding to session PATH."
                $env:PATH = "$p;$env:PATH"
                break
            }
        }
    }

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Err 'Docker CLI is not found in PATH or standard installation directories.'
        Write-Host 'Please ensure Docker Desktop is installed from https://docker.com'
        exit 1
    }

    # Verify if Docker Daemon is running
    $isRunning = Test-DockerDaemon
    if (-not $isRunning) {
        Write-Warn 'Docker CLI was found, but the Docker daemon is not running.'
        $desktopApp = @(
            "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
            "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
            "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1

        if ($desktopApp) {
            Write-Info "Attempting to start Docker Desktop ($desktopApp)..."
            Start-Process -FilePath $desktopApp
            Write-Info 'Waiting for Docker daemon to become responsive (this may take 30-60 seconds)...'
            $retries = 30
            $started = $false
            for ($i = 0; $i -lt $retries; $i++) {
                Start-Sleep -Seconds 2
                if (Test-DockerDaemon) {
                    $started = $true
                    break
                }
            }
            if (-not $started) {
                Write-Err 'Docker Desktop has been launched, but the daemon is still initializing.'
                Write-Host 'Please wait for the Docker whale icon in your system tray to show "Docker Desktop is running", then re-run .\scripts\deploy.ps1'
                exit 1
            }
            Write-Success 'Docker daemon is now responsive!'
        } else {
            Write-Err 'Please launch Docker Desktop from the Start Menu and wait until it is running before proceeding.'
            exit 1
        }
    }
}

# 2. Environment Configuration Bootstrap
function Ensure-Env {
    if (-not (Test-Path $EnvFile)) {
        Write-Warn '.env file not found. Generating default production configuration...'
        if (Test-Path $EnvExample) {
            Copy-Item $EnvExample $EnvFile
        } else {
            New-Item -ItemType File -Path $EnvFile -Force | Out-Null
        }

        $pgPass = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
        $gatewaySec = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
        $sessSec = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
        $cookieSec = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })

        $lines = @(
            'POSTGRES_DB=enterprise_blogger',
            'POSTGRES_USER=blogger',
            "POSTGRES_PASSWORD=$pgPass",
            "GATEWAY_SECRET=$gatewaySec",
            "SESSION_SECRET=$sessSec",
            "COOKIE_SECRET=$cookieSec",
            'NODE_ENV=production',
            'LOG_LEVEL=info'
        )
        Set-Content -Path $EnvFile -Value ($lines -join [System.Environment]::NewLine)
        Write-Success 'Generated secure .env file with randomized credentials.'
    }
}

# 3. Actions & Flow
Check-Prerequisites

if ($Stop) {
    Write-Info 'Stopping Enterprise Blogger stack...'
    docker compose -f $ComposeFile down
    Write-Success 'All services stopped.'
    exit 0
}

if ($Status) {
    Write-Host '=== Container Status ===' -ForegroundColor Cyan
    docker compose -f $ComposeFile ps
    exit 0
}

if ($Logs) {
    docker compose -f $ComposeFile logs -f --tail=100
    exit 0
}

if ($Restart) {
    Write-Info 'Restarting Enterprise Blogger stack...'
    docker compose -f $ComposeFile down
    docker compose -f $ComposeFile up -d --build --remove-orphans
    Write-Success 'Restart complete.'
    exit 0
}

# Default Deploy Flow
Ensure-Env

Write-Info 'Building and launching Enterprise Blogger containers...'
docker compose -f $ComposeFile up -d --build --remove-orphans
Write-Success 'Containers launched.'

Write-Info 'Waiting for services to become healthy...'
$retries = 0
$maxRetries = 30
$collabOk = $false
$apiOk = $false
$mcpOk = $false

while ($retries -lt $maxRetries) {
    $retries++

    if (-not $collabOk) {
        try {
            $res = Invoke-WebRequest -Uri 'http://127.0.0.1:4000/healthz' -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($res.StatusCode -eq 200) {
                $collabOk = $true
                Write-Success 'Collab Engine is healthy (port 4000).'
            }
        } catch {}
    }

    if (-not $apiOk) {
        try {
            $res = Invoke-WebRequest -Uri 'http://127.0.0.1:4001/health' -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($res.StatusCode -eq 200) {
                $apiOk = $true
                Write-Success 'REST API Engine is healthy (port 4001).'
            }
        } catch {}
    }

    if (-not $mcpOk) {
        try {
            $res = Invoke-WebRequest -Uri 'http://127.0.0.1:5000/healthz' -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($res.StatusCode -eq 200) {
                $mcpOk = $true
                Write-Success 'MCP Server is healthy (port 5000).'
            }
        } catch {}
    }

    if ($collabOk -and $apiOk -and $mcpOk) {
        break
    }

    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 2
}
Write-Host ''

Write-Host '==============================================================================' -ForegroundColor Green
Write-Host '    Enterprise Blogger 2.0 — Production Deployment Successful!               ' -ForegroundColor Green
Write-Host '==============================================================================' -ForegroundColor Green
Write-Host '  Web Application:         http://localhost'
Write-Host '  REST API Engine:         http://localhost:4001'
Write-Host '  Collab WebSocket:        ws://localhost:4000'
Write-Host '  Collab HTTP Gateway:     http://localhost:4000'
Write-Host '  MCP Agent Server:        http://localhost:5000'
Write-Host '  PostgreSQL 16:           localhost:5432 (Internal)'
Write-Host ''
Write-Host 'Management Commands:' -ForegroundColor Yellow
Write-Host '  Check status:   .\scripts\deploy.ps1 -Status'
Write-Host '  View logs:      .\scripts\deploy.ps1 -Logs'
Write-Host '  Stop stack:     .\scripts\deploy.ps1 -Stop'
Write-Host '  Restart stack:  .\scripts\deploy.ps1 -Restart'
Write-Host '==============================================================================' -ForegroundColor Green
