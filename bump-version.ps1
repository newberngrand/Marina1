# Bump the cache-busting version on every page and in version.json.
# Run before pushing a change:  .\bump-version.ps1
# Pages load scripts/styles as file.js?v=VERSION; open pages compare against
# version.json and reload themselves when the site has a newer version.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$new = (Get-Date).ToString('yyyyMMddHHmm')
$utf8 = New-Object Text.UTF8Encoding($false)
Get-ChildItem "$root\*.html" | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName)
  $n = [regex]::Replace($t, '\?v=\d{8}[a-z0-9]*', "?v=$new")
  if ($n -ne $t) { [IO.File]::WriteAllText($_.FullName, $n, $utf8) }
}
[IO.File]::WriteAllText("$root\version.json", "{`"v`":`"$new`"}`n", $utf8)
"Version is now $new"
