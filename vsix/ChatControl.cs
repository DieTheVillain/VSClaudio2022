using System;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using Community.VisualStudio.Toolkit;
using Microsoft.VisualStudio;
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
        // VS closes and reopens the same workspace on reload; the teardown waits briefly so that keeps the session.
        private const int CloseGraceMs = 1000;
        private string _closedWorkspace;
        private int _closeGeneration;
        // Counts every close VS reports. A resolve that started before a close may have read the closed
        // workspace, so its result is dropped.
        private int _closeCount;
        // Set when VS closes its solution or folder and cleared only by a real open, so the "workspace needed"
        // re-resolve cannot reconnect the panel to a loose file's folder or the folder that was just closed.
        private volatile bool _closedByVs;

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

            // Subscribe before the first resolve: when VS restores this panel at startup the folder can finish
            // opening while the initial resolve is still in flight, and an event fired in that gap would be lost.
            SubscribeWorkspaceTriggers();
            var closesAtStart = Volatile.Read(ref _closeCount);
            // Only this first resolve falls back to the active document's folder.
            var initial = await Workspace.ResolveAsync(allowActiveDocumentFallback: true);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            if (initial != null && closesAtStart != Volatile.Read(ref _closeCount))
            {
                _log.Info($"Ignoring stale resolve (closed since): {initial}");
                initial = null;
            }
            // A trigger may already have found the workspace while this resolve was in flight.
            if (initial != null || _workspace == null) _workspace = initial ?? _workspace;
            _log.Info($"Initial workspace: {initial ?? "(none)"} (current: {_workspace ?? "(none)"})");

            var extensionDir = Path.GetDirectoryName(typeof(ChatControl).Assembly.Location);
            var sidecarExe = Path.Combine(extensionDir, "sidecar", "vsclaudio-sidecar.exe");
            _bridge = new Bridge(() => new SidecarProcess(sidecarExe, "", _log), this, _log, () => _folderOverride ?? _workspace, new EditReviewer(_log), new EditorBuffers(_log));
            _bridge.ChooseFolderRequested += ChooseFolder;
            _bridge.WorkspaceNeeded += () =>
            {
                if (_closedByVs)
                {
                    _log.Info("Workspace closed by VS; waiting for an open.");
                    return;
                }
                _log.Info("Workspace needed; re-resolving.");
                OnWorkspaceMayHaveChanged(null, "WorkspaceNeeded");
            };
            _log.Info($"Sidecar: {sidecarExe}; workspace: {_workspace ?? "(none)"}");

            // Catches a workspace that finished loading between the resolve above and the bridge existing.
            OnWorkspaceMayHaveChanged(null, "init");
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

        private void SubscribeWorkspaceTriggers()
        {
            VS.Events.SolutionEvents.OnAfterOpenSolution += _ => { _log.Info("Event: OnAfterOpenSolution"); OnWorkspaceOpened(null, "OnAfterOpenSolution"); };
            VS.Events.SolutionEvents.OnAfterOpenFolder += folder => { _log.Info($"Event: OnAfterOpenFolder '{folder}'"); OnWorkspaceOpened(folder, "OnAfterOpenFolder"); };
            VS.Events.SolutionEvents.OnAfterCloseSolution += () => { _log.Info("Event: OnAfterCloseSolution"); OnWorkspaceClosed(); };
            VS.Events.SolutionEvents.OnAfterCloseFolder += folder => { _log.Info($"Event: OnAfterCloseFolder '{folder}'"); OnWorkspaceClosed(); };

            // Context state cannot be missed the way an event can: WhenActivated runs at once if already active.
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                foreach (var guid in new[] { VSConstants.UICONTEXT.FolderOpened_guid, VSConstants.UICONTEXT.SolutionExistsAndFullyLoaded_guid })
                {
                    var context = UIContext.FromUIContextGuid(guid);
                    var name = guid == VSConstants.UICONTEXT.FolderOpened_guid ? "FolderOpened" : "SolutionExistsAndFullyLoaded";
                    context.WhenActivated(() => { _log.Info($"UI context active: {name}"); OnWorkspaceOpened(null, name); });
                    context.UIContextChanged += (_, e) =>
                    {
                        if (!e.Activated) return;
                        _log.Info($"UI context activated: {name}");
                        OnWorkspaceOpened(null, name);
                    };
                }
            }).FileAndForget("VSClaudio/workspace");
        }

        // A real open (an open event, or a UI context activating after the close) ends the "closed by VS" state.
        private void OnWorkspaceOpened(string openedFolder, string source)
        {
            if (_closedByVs) _log.Info($"Workspace opened ({source}) after a close by VS.");
            _closedByVs = false;
            OnWorkspaceMayHaveChanged(openedFolder, source);
        }

        private void OnWorkspaceMayHaveChanged(string openedFolder, string source)
        {
            var closesAtStart = Volatile.Read(ref _closeCount);
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                string resolved = null;
                // The folder can still be loading when the trigger fires, so a null result is retried briefly.
                for (var attempt = 0; attempt < 3; attempt++)
                {
                    resolved = !string.IsNullOrEmpty(openedFolder) && Directory.Exists(openedFolder)
                        ? openedFolder
                        : await Workspace.ResolveAsync(allowActiveDocumentFallback: false);
                    _log.Info($"Resolve ({source}, attempt {attempt + 1}): {resolved ?? "(none)"}");
                    if (resolved != null) break;
                    try { await Task.Delay(500, VsShellUtilities.ShutdownToken); }
                    catch (OperationCanceledException) { return; }
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                if (resolved == null) return;
                if (closesAtStart != Volatile.Read(ref _closeCount))
                {
                    // Started before a close, so it may have read the workspace that has since closed.
                    _log.Info($"Ignoring stale resolve (closed since): {resolved} ({source})");
                    return;
                }

                var closed = _closedWorkspace;
                _closedWorkspace = null;
                Interlocked.Increment(ref _closeGeneration);
                // The panel is showing "No folder open" with nothing running, so any resolved workspace must connect,
                // even if it equals what was recorded earlier (e.g. recorded before the webview was ready).
                var idle = _folderOverride == null && _bridge != null && _bridge.NeedsWorkspace;

                if (!idle && _workspace == null && closed != null && Workspace.SameFolder(resolved, closed))
                {
                    // Same workspace reopened before the close took effect: the session is still running in it.
                    _workspace = closed;
                    return;
                }

                if (!idle && Workspace.SameFolder(resolved, _folderOverride ?? _workspace)) return;
                _folderOverride = null;
                _workspace = resolved;
                _log.Info(idle ? $"Workspace available ({resolved}); connecting." : $"Workspace changed to {resolved}; starting a new session.");
                // Before the bridge exists the workspace func simply reads the value set above.
                _bridge?.SwitchWorkspace();
            }).FileAndForget("VSClaudio/workspace");
        }

        private void OnWorkspaceClosed()
        {
            // Recorded synchronously in the close event so that resolves already in flight see it.
            Interlocked.Increment(ref _closeCount);
            _closedByVs = true;
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                // A folder picked with "Choose folder..." is independent of what VS has open.
                if (_folderOverride != null || _workspace == null) return;
                _closedWorkspace = _workspace;
                _workspace = null;
                var generation = Interlocked.Increment(ref _closeGeneration);

                try { await Task.Delay(CloseGraceMs, VsShellUtilities.ShutdownToken); }
                catch (OperationCanceledException) { return; }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

                if (generation != _closeGeneration || _workspace != null || _folderOverride != null || _bridge == null) return;
                _closedWorkspace = null;
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
