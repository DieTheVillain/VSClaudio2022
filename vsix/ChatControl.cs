using System;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using Community.VisualStudio.Toolkit;
using Microsoft.VisualStudio.PlatformUI;
using Microsoft.VisualStudio.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using VSClaudio.Core;
using Task = System.Threading.Tasks.Task;

namespace VSClaudio
{
    public sealed class ChatControl : UserControl, IWebviewPoster
    {
        private const string Origin = "https://vsclaudio.local/";
        private readonly WebView2 _web = new ChatWebView();
        private readonly ConcurrentQueue<string> _outbox = new ConcurrentQueue<string>();
        private int _drainScheduled;
        private bool _started;
        private Bridge _bridge;
        private OutputLog _log;
        private volatile string _workspace;
        private volatile string _folderOverride;

        public ChatControl()
        {
            Content = _web;
            // Loaded fires again whenever the tab is re-shown; the session must survive that.
            Loaded += (_, __) =>
            {
                if (_started) return;
                _started = true;
                ThreadHelper.JoinableTaskFactory.RunAsync(InitAsync).FileAndForget("VSClaudio/init");
            };
        }

        public void Post(string json)
        {
            // Bridge calls arrive from sidecar reader threads; a single queue keeps messages in order.
            _outbox.Enqueue(json);
            if (Interlocked.Exchange(ref _drainScheduled, 1) == 0)
                ThreadHelper.JoinableTaskFactory.RunAsync(DrainAsync).FileAndForget("VSClaudio/post");
        }

        private async Task DrainAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            Interlocked.Exchange(ref _drainScheduled, 0);
            while (_outbox.TryDequeue(out var json)) _web.CoreWebView2?.PostWebMessageAsJson(json);
        }

        private async Task InitAsync()
        {
            _log = await OutputLog.CreateAsync();
            _workspace = await Workspace.ResolveAsync();

            var extensionDir = Path.GetDirectoryName(typeof(ChatControl).Assembly.Location);
            var sidecarExe = Path.Combine(extensionDir, "sidecar", "vsclaudio-sidecar.exe");
            _bridge = new Bridge(() => new SidecarProcess(sidecarExe, "", _log), this, _log, () => _folderOverride ?? _workspace, new EditReviewer(_log), new EditorBuffers(_log));
            _bridge.ChooseFolderRequested += ChooseFolder;
            _log.Info($"Sidecar: {sidecarExe}; workspace: {_workspace ?? "(none)"}");

            VS.Events.SolutionEvents.OnAfterOpenSolution += _ => OnWorkspaceMayHaveChanged();
            VS.Events.SolutionEvents.OnAfterOpenFolder += folder => OnWorkspaceMayHaveChanged(folder);
            VS.Events.SolutionEvents.OnAfterCloseSolution += OnWorkspaceClosed;
            VS.Events.SolutionEvents.OnAfterCloseFolder += _ => OnWorkspaceClosed();
            VSColorTheme.ThemeChanged += _ => _bridge.PostTheme(ThemeVars.Current());

            var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSClaudio", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await _web.EnsureCoreWebView2Async(env);
            var core = _web.CoreWebView2;
            // No Reload menu or browser shortcuts: a reload drops the transcript mid-session.
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.ProcessFailed += (s, e) =>
            {
                _log.Info($"WebView2 process failed: {e.ProcessFailedKind} ({e.Reason}).");
                // The reloaded page sends webview_ready again and the bridge re-posts status and theme.
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited
                    || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                    core.Reload();
            };
            core.SetVirtualHostNameToFolderMapping("vsclaudio.local", Path.Combine(extensionDir, "web"), CoreWebView2HostResourceAccessKind.Allow);
            core.WebMessageReceived += (s, e) => _bridge.OnWebviewMessage(e.TryGetWebMessageAsString());
            core.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                OpenExternal(e.Uri);
            };
            core.NavigationStarting += (s, e) =>
            {
                if (e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) return;
                e.Cancel = true;
                OpenExternal(e.Uri);
            };
            _bridge.PostTheme(ThemeVars.Current());
            core.Navigate(Origin + "index.html");
        }

        private void OnWorkspaceMayHaveChanged(string openedFolder = null)
        {
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                var resolved = !string.IsNullOrEmpty(openedFolder) && Directory.Exists(openedFolder)
                    ? openedFolder
                    : await Workspace.ResolveAsync();
                if (resolved == null || Workspace.SameFolder(resolved, _folderOverride ?? _workspace)) return;
                _folderOverride = null;
                _workspace = resolved;
                _log.Info($"Workspace changed to {resolved}; starting a new session.");
                _bridge.SwitchWorkspace();
            }).FileAndForget("VSClaudio/workspace");
        }

        private void OnWorkspaceClosed()
        {
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                // A folder picked with "Choose folder..." is independent of what VS has open.
                if (_folderOverride != null || _workspace == null) return;
                _workspace = null;
                _log.Info("Visual Studio closed its solution or folder; no workspace.");
                _bridge.SwitchWorkspace();
            }).FileAndForget("VSClaudio/workspace");
        }

        private void ChooseFolder()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            using (var dialog = new System.Windows.Forms.FolderBrowserDialog { Description = "Folder for Claude to work in" })
            {
                if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
                _folderOverride = dialog.SelectedPath;
            }
            _bridge.Reconnect();
        }

        private void OpenExternal(string uri)
        {
            if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp))
                return;
            // Runs inside a WebView2 event on the UI thread, so a failure here must not escape into Visual Studio.
            try
            {
                Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Exception ex) when (ex is Win32Exception || ex is InvalidOperationException)
            {
                _log.Info($"Could not open {u.AbsoluteUri}: {ex.Message}");
            }
        }
    }
}
