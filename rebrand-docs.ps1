$files = Get-ChildItem -Recurse -File -Include *.md,*.txt,*.sh,*.yml,*.yaml,*.json | Where-Object { $_.FullName -notmatch 'node_modules|\.git' }

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $content = $content -replace 'pop-pay', 'hangpay'
    $content = $content -replace 'Point One Percent', 'HangPay'
    $content = $content -replace '100xPercent', 'akshay'
    $content = $content -replace 'TPEmist', 'akshay'
    $content = $content -replace 'security@pop-pay.ai', 'security@hangpay.dev'
    $content = $content -replace 'POP_', 'HANGPAY_'
    $content = $content -replace 'pop_pay', 'hangpay'
    $content = $content -replace '\.config/pop-pay', '.config/hangpay'
    Set-Content $file.FullName $content
    Write-Host "Updated: $($file.FullName)"
}