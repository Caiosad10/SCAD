' Inicia o servidor do SCAD em segundo plano, sem janela nenhuma.
'
' Feito para a pasta Inicializar do Windows (veja instalar-inicio-automatico.ps1):
' fica invisivel, grava o log em logs\servidor.log e nao faz nada se o servidor
' ja estiver no ar (evita subir duas copias disputando a porta 4177).
Option Explicit

Dim fso, shell, raiz, porta, ocupada

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

raiz = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
porta = 4177

' Ja existe servidor escutando na porta? Entao nao sobe outro.
ocupada = shell.Run("cmd /c netstat -an | find ""LISTENING"" | find "":4177""", 0, True)
If ocupada = 0 Then
  WScript.Quit 0
End If

' O wrapper cuida do diretorio, do log e da porta configurada.
shell.Run Chr(34) & raiz & "\scripts\servico-scad.cmd" & Chr(34), 0, False
