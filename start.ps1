# Eddie Voice App Startup Script
# Ensures both WebSocket server and Vite dev server are running

$ErrorActionPreference = "SilentlyContinue"

Write-Host "`n=== Eddie Voice App ===" -ForegroundColor Cyan

# Get local IP address
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.*" } | Select-Object -First 1).IPAddress

# Check if WebSocket server (port 3001) is running
$ws3001 = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue

if ($ws3001) {
    Write-Host "[OK] WebSocket server already running on port 3001" -ForegroundColor Green
} else {
    Write-Host "[..] Starting WebSocket server..." -ForegroundColor Yellow
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
    Start-Sleep -Seconds 2

    $ws3001 = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if ($ws3001) {
        Write-Host "[OK] WebSocket server started on port 3001" -ForegroundColor Green
    } else {
        Write-Host "[!!] Failed to start WebSocket server" -ForegroundColor Red
    }
}

# Check if Vite dev server (port 5173) is running
$vite5173 = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue

if ($vite5173) {
    Write-Host "[OK] Vite dev server already running on port 5173" -ForegroundColor Green
} else {
    Write-Host "[..] Starting Vite dev server..." -ForegroundColor Yellow
    Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory "$PSScriptRoot\client" -WindowStyle Minimized
    Start-Sleep -Seconds 3

    $vite5173 = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
    if ($vite5173) {
        Write-Host "[OK] Vite dev server started on port 5173" -ForegroundColor Green
    } else {
        Write-Host "[!!] Failed to start Vite dev server" -ForegroundColor Red
    }
}

# Display connection info
Write-Host "`n=== Connection Info ===" -ForegroundColor Cyan
Write-Host "Local:   " -NoNewline; Write-Host "https://localhost:5173" -ForegroundColor White
if ($localIP) {
    Write-Host "Network: " -NoNewline; Write-Host "https://${localIP}:5173" -ForegroundColor White
}
Write-Host ""
