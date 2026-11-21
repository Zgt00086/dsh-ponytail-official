param(
    [string]$Title = 'DeepSeek Harness',
    [string]$Message = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Aumid = 'ai.deepseek.dsh.desktop'

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
        if ($fgPid -ne 0) {
            $procName = ''
            try { $procName = (Get-Process -Id $fgPid -ErrorAction Stop).ProcessName } catch { $procName = '' }
            if ($procName -match 'DeepSeek|dsh') { exit 0 }
        }
    }

    Show-Toast -T $Title -M $Message
}
catch {
    # 通知失败不影响主流程，静默退出
}

exit 0
