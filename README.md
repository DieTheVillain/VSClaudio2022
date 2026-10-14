# VSClaudio2022

Visual Studio 2022 extension that hosts a Claude Code chat panel.

## Layout

- `protocol/` – message types shared by the sidecar and the webview (TypeScript source of truth).
- `sidecar/` – Bun/TypeScript process that runs Claude Code through the Agent SDK; compiled to a single exe.
- `webview/` – React chat UI rendered inside WebView2.
- `core/` – VS-independent C# library: protocol helpers, the bridge, sidecar process management.
- `core.Tests/` – xUnit tests for `core/`.
- `vsix/` – the Visual Studio extension.

## Build

Requires Bun, Node (dev only), the .NET SDK and VS 2022 with the "Visual Studio extension development" workload.

    powershell -ExecutionPolicy Bypass -File scripts\build.ps1

Then run the experimental instance (`devenv.exe /rootsuffix Exp`) and open *View → Other Windows → VSClaudio*.

Claude Code must be installed and logged in. Override its location with the `VSCLAUDIO_CLAUDE_PATH` environment variable.
