# PowerShell 脚本：加载标注文件并提取关键信息
# 用法：.\load-annotations.ps1

$annotationPath = "D:\0 因赛集团\人工审核 - 标注版本"
$outputPath = "C:\Users\方正东\.openclaw\workspace\skills\human-needs-insight\annotations-summary.md"

Write-Host "正在扫描标注文件..." -ForegroundColor Cyan

try {
    # 获取所有 markdown 文件
    $files = Get-ChildItem -Path $annotationPath -Filter "*.md" -Recurse -ErrorAction Stop
    Write-Host "找到 $($files.Count) 个标注文件" -ForegroundColor Green
    
    # 创建摘要文件
    $summary = @"
# 标注文件摘要

生成时间：$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
标注路径：$annotationPath
文件总数：$($files.Count)

---

## 文件列表

| 文件名 | 大小 (KB) | 最后修改 |
|--------|-----------|----------|
"@
    
    foreach ($file in $files) {
        $sizeKB = [math]::Round($file.Length / 1KB, 2)
        $modified = $file.LastWriteTime.ToString("yyyy-MM-dd HH:mm")
        $summary += "`n| $($file.Name) | $sizeKB | $modified |"
    }
    
    $summary += "`n`n---`n`n## 内容分析`n`n"
    
    # 读取前 5 个文件的内容进行分析
    $sampleSize = [Math]::Min(5, $files.Count)
    Write-Host "分析前 $sampleSize 个文件的内容..." -ForegroundColor Cyan
    
    for ($i = 0; $i -lt $sampleSize; $i++) {
        $file = $files[$i]
        Write-Host "  处理：$($file.Name)" -ForegroundColor Gray
        
        $content = Get-Content -Path $file.FullName -Encoding UTF8 -Raw
        $summary += "`n### 样例 $($i + 1): $($file.Name)`n`n"
        $summary += "``````markdown`n$content`n```````n`n"
    }
    
    # 写入摘要文件
    $summary | Out-File -FilePath $outputPath -Encoding UTF8
    Write-Host "`n摘要已保存到：$outputPath" -ForegroundColor Green
    
} catch {
    Write-Host "错误：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`n请检查:" -ForegroundColor Yellow
    Write-Host "  1. 标注路径是否正确：$annotationPath" -ForegroundColor Yellow
    Write-Host "  2. 是否有权限访问该目录" -ForegroundColor Yellow
    Write-Host "  3. 目录中是否存在 .md 文件" -ForegroundColor Yellow
}
