function ConvertTo-NativeArgument {
  param([AllowEmptyString()][string]$Value)
  if($Value.Length -gt 0 -and $Value -notmatch '[\s"]'){return $Value}
  $escaped=[regex]::Replace($Value,'(\\*)"', '$1$1\"')
  $escaped=[regex]::Replace($escaped,'(\\+)$', '$1$1')
  return '"'+$escaped+'"'
}
function Invoke-NativeCommand {
  param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][AllowEmptyCollection()][string[]]$ArgumentList,[Parameter(Mandatory=$true)][string]$LogPath,[switch]$AllowFailure)
  $logDirectory=Split-Path -Parent $LogPath
  if($logDirectory){New-Item -ItemType Directory -Force -Path $logDirectory|Out-Null}
  $psi=New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName=$Executable
  $psi.Arguments=(($ArgumentList|ForEach-Object{ConvertTo-NativeArgument $_}) -join ' ')
  $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
  $process=New-Object System.Diagnostics.Process;$process.StartInfo=$psi
  $startedAt=[DateTimeOffset]::UtcNow
  if(-not $process.Start()){throw "failed to start native command: $Executable"}
  $stdoutTask=$process.StandardOutput.ReadToEndAsync();$stderrTask=$process.StandardError.ReadToEndAsync()
  $process.WaitForExit();$exitCode=$process.ExitCode;$stdout=$stdoutTask.Result;$stderr=$stderrTask.Result;$finishedAt=[DateTimeOffset]::UtcNow
  $utf8=New-Object System.Text.UTF8Encoding($false)
  $nl=[Environment]::NewLine;$combined='[stdout]'+$nl+$stdout+$nl+'[stderr]'+$nl+$stderr
  [System.IO.File]::WriteAllText($LogPath,$combined,$utf8)
  $record=[ordered]@{executable=$Executable;argv=@($ArgumentList);startedAt=$startedAt.ToString('o');finishedAt=$finishedAt.ToString('o');exitCode=$exitCode;stdoutLog=(Split-Path -Leaf $LogPath);stderrCaptured=$true}
  [System.IO.File]::WriteAllText(($LogPath+'.command.json'),($record|ConvertTo-Json -Depth 5),$utf8)
  $result=[pscustomobject]@{ExitCode=$exitCode;Stdout=$stdout;Stderr=$stderr;LogPath=$LogPath;CommandRecordPath=($LogPath+'.command.json')}
  if($exitCode -ne 0 -and -not $AllowFailure){throw "native command failed with exit code ${exitCode}: $Executable $($ArgumentList -join ' '); log: $LogPath"}
  return $result
}
