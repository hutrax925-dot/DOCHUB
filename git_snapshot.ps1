$ts = (Get-Date).ToString('yyyyMMdd-HHmmss')
if (-not (Test-Path .git)) { git init }
# Configure defaults if not set
git config user.name "docubackup" 2>$null
git config user.email "backup@local" 2>$null

git add -A
if (-not (git rev-parse --verify HEAD 2>$null)) {
    git commit --allow-empty -m "Snapshot $ts"
} else {
    $st = git status --porcelain
    if ($st) {
        git commit -m "Snapshot $ts"
    } else {
        Write-Host "No changes to commit"
    }
}

git tag -f "snapshot-$ts"
Write-Host "SNAPSHOT_CREATED: snapshot-$ts"
# show short commit id and tags
$commit = git rev-parse --short HEAD
Write-Host "COMMIT: $commit"
git tag --points-at HEAD | ForEach-Object { Write-Host "TAG: $_" }
