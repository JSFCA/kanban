# Stop and remove the Kanban Studio container. Windows.
$ErrorActionPreference = "Stop"

$Container = "kanban-studio"

# `docker rm -f` exits 0 whether or not the container exists, so check first.
$existing = docker ps -aq --filter "name=^${Container}$"
if ($existing) {
    docker rm -f $Container | Out-Null
    Write-Host "Stopped $Container."
} else {
    Write-Host "$Container was not running."
}
