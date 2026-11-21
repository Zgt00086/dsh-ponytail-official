param(
    [string]$Title = 'DeepSeek Harness',
    [string]$Message = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Aumid = 'ai.deepseek.dsh.desktop'
$LogFile = Join-Path $env:TEMP 'ponytail-notify.log'

function Write-NotifyLog {
    param([string]$Text)
    try {
        $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
        Add-Content -Path $LogFile -Value "$stamp | $Text" -Encoding UTF8
    } catch { }
}

function Show-Toast {
    param([string]$T, [string]$M)

    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
        [Windows.UI.Notifications.ToastTemplateType]::ToastText02
    )
    $texts = $template.GetElementsByTagName('text')
    [void]$texts.Item(0).AppendChild($template.CreateTextNode($T))
    [void]$texts.Item(1).AppendChild($template.CreateTextNode($M))
    $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid).Show($toast)
}

Write-NotifyLog "start title=$Title force=$Force"

try {
    if (-not $Force) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PonytailFg {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
'@ -ErrorAction Stop

        $h = [PonytailFg]::GetForegroundWindow()
        $fgPid = [uint32]0
        [void][PonytailFg]::GetWindowThreadProcessId($h, [ref]$fgPid)
        $procName = '(none)'
        if ($fgPid -ne 0) {
            try { $procName = (Get-Process -Id $fgPid -ErrorAction Stop).ProcessName } catch { $procName = '(unknown)' }
        }
        Write-NotifyLog "foreground=$procName"
        if ($procName -match 'DeepSeek|dsh') {
            Write-NotifyLog 'skip: DSH is foreground'
            exit 0
        }
    }

    Show-Toast -T $Title -M $Message
    Write-NotifyLog 'sent'
}
catch {
    Write-NotifyLog "error: $($_.Exception.Message)"
}

exit 0
