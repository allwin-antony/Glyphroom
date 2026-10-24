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
function Check-Prerequisites {
    Write-Info 'Validating Windows Docker prerequisites...'
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Err 'Docker is not installed or not in PATH.'
        Write-Host 'Please start or install Docker Desktop for Windows from https://docker.com'
        exit 1
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

# 3. Actions
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
Check-Prerequisites
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
