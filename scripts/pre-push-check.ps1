#!/usr/bin/env pwsh
<##
.SYNOPSIS
  Pre-push checks for Windows. The commands mirror the CI checks that are
  executable on Windows and include the PR's relevant dist test suites.
#>

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
$failed = $false

function Run-Check {
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Host (">>> " + $Label + " ...") -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    Write-Host ("FAIL: " + $Label) -ForegroundColor Red
    $script:failed = $true
  } else {
    Write-Host ("OK: " + $Label) -ForegroundColor Green
  }
}

Push-Location $repoRoot
try {
  Write-Host ">>> Fetch upstream/main ..." -ForegroundColor Cyan
  git fetch upstream main
  if ($LASTEXITCODE -ne 0) {
    throw "Cannot fetch upstream/main"
  }

  $behind = [int](git rev-list --count HEAD..upstream/main)
  if ($behind -gt 0) {
    Write-Host ("FAIL: branch is behind upstream/main by " + $behind + " commit(s); rebase first") -ForegroundColor Red
    exit 1
  }
  Write-Host "OK: branch is not behind upstream/main" -ForegroundColor Green

  Run-Check "Protocol epoch guard" {
    node scripts/protocol-epoch-check.mjs --base upstream/main
  }
  Run-Check "Build test artifacts" {
    npm run build:test
  }
  Run-Check "Lint" {
    npm run lint
  }
  Run-Check "Format check" {
    npm run format:check
  }
  Run-Check "Typecheck" {
    npm run typecheck
  }
  Run-Check "Desktop MCP and capability dist tests" {
    node --test "apps/desktop/dist/main/__tests__/mcp-runtime-e2e.test.js" "apps/desktop/dist/main/__tests__/runtime-host-native-capabilities.test.js" "apps/desktop/dist/main/__tests__/runtime-host-desktop-candidate.test.js"
  }
  Run-Check "Runtime MCP dist tests" {
    node --test "packages/runtime/dist/__tests__/mcp-tools.test.js"
  }
  Run-Check "Runtime Host Client Capability protocol dist tests" {
    node --test "packages/runtime-host/dist/__tests__/client-capability-protocol.test.js"
  }
  Run-Check "Diff check" {
    git diff --check
  }
  Run-Check "Unresolved conflict check" {
    $conflicts = git diff --name-only --diff-filter=U
    if ($conflicts) {
      $conflicts
      exit 1
    }
  }

  if ($failed) {
    Write-Host "PRE-PUSH CHECKS FAILED" -ForegroundColor Red
    exit 1
  }
  Write-Host "ALL PRE-PUSH CHECKS PASSED" -ForegroundColor Green
} finally {
  Pop-Location
}
