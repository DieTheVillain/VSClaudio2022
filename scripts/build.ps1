# Builds and tests every part, then builds the VSIX and deploys it to the experimental instance.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bunCmd = Get-Command bun -ErrorAction SilentlyContinue
$bun = if ($bunCmd) { $bunCmd.Source } else { Join-Path $env:USERPROFILE '.bun\bin\bun.exe' }
$msbuild = 'C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe'

function Step([string]$name, [scriptblock]$body) {
    Write-Host "== $name" -ForegroundColor Cyan
    & $body
    if ($LASTEXITCODE -ne 0) { throw "$name failed (exit $LASTEXITCODE)" }
}

# The sidecar and webview builds write into these folders but do not create them.
New-Item -ItemType Directory -Force -Path (Join-Path $root 'vsix\sidecar'), (Join-Path $root 'vsix\web') | Out-Null

Push-Location (Join-Path $root 'protocol')
try {
    Step 'protocol: install' { & $bun install }
    Step 'protocol: generate fixtures' { & $bun run gen }
    Step 'protocol: test' { & $bun test }
} finally { Pop-Location }

Push-Location (Join-Path $root 'sidecar')
try {
    Step 'sidecar: install' { & $bun install }
    Step 'sidecar: test' { & $bun test }
    Step 'sidecar: compile' { & $bun run build }
} finally { Pop-Location }

Push-Location (Join-Path $root 'webview')
try {
    Step 'webview: install' { npm install --no-audit --no-fund }
    Step 'webview: test' { npx vitest run }
    Step 'webview: build' { npm run build }
} finally { Pop-Location }

Step 'core: test' { dotnet test (Join-Path $root 'core.Tests') }
Step 'vsix: build' { & $msbuild (Join-Path $root 'vsix\VSClaudio.csproj') /restore /p:Configuration=Debug /v:minimal /nologo }
Write-Host 'Done. Launch: devenv.exe /rootsuffix Exp, then View > Other Windows > VSClaudio' -ForegroundColor Green
