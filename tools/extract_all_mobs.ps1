# Batch extract all creature models from EQ client using LanternExtractor
# Then copy the GLBs to the Godot Data/Characters folder

$lanternExe = "D:\Kael Kodes\EQMUD\server\tools\LanternExtractor\LanternExtractor.exe"
$exportsDir = "D:\Kael Kodes\EQMUD\server\tools\LanternExtractor\Exports"
$targetDir  = "D:\Kael Kodes\EQMUD\eqmud\Data\Characters"
$eqDir      = "D:\EQ"

# Get all _chr.s3d files and extract the model code (e.g. orc_chr.s3d -> orc)
$chrFiles = Get-ChildItem -Path "$eqDir\*_chr.s3d" | ForEach-Object { $_.BaseName -replace '_chr$', '' } | Sort-Object -Unique

# Skip ones that are already global player models (already extracted)
$skipList = @('global','global2','global3','global4','global5','global6','global7',
              'globalbaf','globalbam','globaldaf','globaldam','globaldwf','globaldwm',
              'globalelf','globalelm','globalerf','globalerm','globalfroglok',
              'globalgnf','globalgnm','globalhaf','globalham','globalhif','globalhim',
              'globalhof','globalhom','globalhuf','globalhum','globalikf','globalikm',
              'globalkef','globalkem','globalogf','globalogm','globalpcfroglok',
              'globaltrf','globaltrm')

$total = ($chrFiles | Where-Object { $_ -notin $skipList }).Count
$current = 0
$extracted = 0
$failed = 0

Write-Host "=== Extracting $total creature models ===" -ForegroundColor Cyan

foreach ($code in $chrFiles) {
    if ($code -in $skipList) { continue }
    $current++
    Write-Host "[$current/$total] Extracting: $code" -ForegroundColor Yellow -NoNewline
    
    try {
        $output = & $lanternExe $code 2>&1
        
        # Find the GLB output
        $glbFiles = Get-ChildItem -Path "$exportsDir\$code\Characters\*.glb" -ErrorAction SilentlyContinue
        
        if ($glbFiles) {
            foreach ($glb in $glbFiles) {
                Copy-Item -Path $glb.FullName -Destination "$targetDir\$($glb.Name)" -Force
            }
            $extracted++
            Write-Host " -> OK ($($glbFiles.Count) GLB)" -ForegroundColor Green
        } else {
            $failed++
            Write-Host " -> No GLB found" -ForegroundColor DarkGray
        }
    } catch {
        $failed++
        Write-Host " -> ERROR: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Cyan
Write-Host "Extracted: $extracted models" -ForegroundColor Green
Write-Host "No GLB:    $failed models" -ForegroundColor DarkGray

# Count total models now in target
$totalModels = (Get-ChildItem -Path "$targetDir\*.glb").Count
Write-Host "Total GLBs in Data/Characters: $totalModels" -ForegroundColor Cyan
