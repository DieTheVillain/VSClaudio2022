using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Imaging;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using VSClaudio.Core;
using Task = System.Threading.Tasks.Task;

namespace VSClaudio
{
    /// <summary>
    /// Shows a proposed edit in Visual Studio's side-by-side diff with Accept/Reject in an InfoBar.
    /// The bridge calls in under its lock from background threads, so every entry point only schedules UI work and never throws.
    /// </summary>
    internal sealed class EditReviewer : IEditReviewer
    {
        private const string AcceptLabel = "Accept";
        private const string RejectLabel = "Reject";

        private readonly ILog _log;
        // Only touched on the UI thread.
        private readonly Dictionary<string, IVsWindowFrame> _frames = new Dictionary<string, IVsWindowFrame>();
        private bool _swept;

        public EditReviewer(ILog log) => _log = log;

        public event Action<string, string> Decided;

        public void Open(string id, string path, string original, string proposed, bool isNewFile) =>
            Schedule($"open the diff for {path}", async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                OpenOnUiThread(id, path, original, proposed, isNewFile);
            });

        public void Close(string id) =>
            Schedule($"close the diff {id}", async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                CloseOnUiThread(id);
            });

        private void Schedule(string what, Func<Task> work)
        {
            try
            {
                ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
                {
                    try
                    {
                        await work();
                    }
                    catch (Exception ex)
                    {
                        _log.Info($"Could not {what}: {ex.Message}");
                    }
                }).FileAndForget("VSClaudio/diff");
            }
            catch (Exception ex)
            {
                _log.Info($"Could not {what}: {ex.Message}");
            }
        }

        private void OpenOnUiThread(string id, string path, string original, string proposed, bool isNewFile)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (_frames.TryGetValue(id, out var existing))
            {
                ErrorHandler.ThrowOnFailure(existing.Show());
                return;
            }

            SweepStaleFolders();
            // A folder can survive from a tab the user closed or from an earlier VS session; its files are read-only.
            DeleteTempFolder(id);
            var folder = TempFolder(id);
            Directory.CreateDirectory(folder);
            var name = Path.GetFileNameWithoutExtension(path);
            var ext = Path.GetExtension(path);
            // Keep the real extension last so the diff picks the right syntax highlighting.
            var left = Path.Combine(folder, $"{name}.current{ext}");
            var right = Path.Combine(folder, $"{name}.proposed{ext}");
            File.WriteAllText(left, original ?? "");
            File.WriteAllText(right, proposed ?? "");
            File.SetAttributes(left, FileAttributes.ReadOnly);
            File.SetAttributes(right, FileAttributes.ReadOnly);

            var diff = (IVsDifferenceService)ServiceProvider.GlobalProvider.GetService(typeof(SVsDifferenceService));
            if (diff == null) throw new InvalidOperationException("The difference service is unavailable.");
            var frame = diff.OpenComparisonWindow2(
                left,
                right,
                $"Claude: {Path.GetFileName(path)}",
                path,
                isNewFile ? "(new file)" : "Current",
                "Proposed",
                null,
                null,
                (uint)(__VSDIFFSERVICEOPTIONS.VSDIFFOPT_LeftFileIsTemporary | __VSDIFFSERVICEOPTIONS.VSDIFFOPT_RightFileIsTemporary));
            if (frame == null) throw new InvalidOperationException("The diff window did not open.");

            _frames[id] = frame;
            if (frame is IVsWindowFrame2 frame2)
                frame2.Advise(new FrameClosedNotify(() => OnFrameClosed(id, frame)), out _);
            AddInfoBar(id, frame);
        }

        private void AddInfoBar(string id, IVsWindowFrame frame)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            ErrorHandler.ThrowOnFailure(frame.GetProperty((int)__VSFPROPID7.VSFPROPID_InfoBarHost, out var hostObj));
            if (!(hostObj is IVsInfoBarHost host)) throw new InvalidOperationException("The diff window has no InfoBar host.");
            var factory = (IVsInfoBarUIFactory)ServiceProvider.GlobalProvider.GetService(typeof(SVsInfoBarUIFactory));
            if (factory == null) throw new InvalidOperationException("The InfoBar factory is unavailable.");

            // No close button: the request stays pending until the user decides here or in the chat card.
            var model = new InfoBarModel(
                new[] { new InfoBarTextSpan("Claude wants to edit this file.") },
                new IVsInfoBarActionItem[] { new InfoBarButton(AcceptLabel, "allow"), new InfoBarButton(RejectLabel, "deny") },
                KnownMonikers.StatusInformation,
                isCloseButtonVisible: false);
            var element = factory.CreateInfoBar(model);
            element.Advise(new InfoBarEvents(decision => RaiseDecided(id, decision)), out _);
            host.AddInfoBar(element);
        }

        private void RaiseDecided(string id, string decision)
        {
            try
            {
                Decided?.Invoke(id, decision);
            }
            catch (Exception ex)
            {
                _log.Info($"Could not apply the diff decision for {id}: {ex.Message}");
            }
        }

        private void OnFrameClosed(string id, IVsWindowFrame frame)
        {
            // Closing the tab by hand leaves the request pending; the chat card can still decide or reopen it.
            if (_frames.TryGetValue(id, out var current) && current == frame) _frames.Remove(id);
        }

        private void CloseOnUiThread(string id)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                if (_frames.TryGetValue(id, out var frame))
                {
                    _frames.Remove(id);
                    frame.CloseFrame((uint)__FRAMECLOSE.FRAMECLOSE_NoSave);
                }
            }
            finally
            {
                DeleteTempFolder(id);
            }
        }

        private void DeleteTempFolder(string id) => DeleteFolder(TempFolder(id));

        private void DeleteFolder(string folder)
        {
            // A recursive delete must never reach the diffs root or anything outside it.
            if (!DiffPaths.IsStrictlyUnder(DiffsRoot(), folder))
            {
                _log.Info($"Refused to delete {folder}: it is not inside {DiffsRoot()}.");
                return;
            }
            if (!Directory.Exists(folder)) return;
            foreach (var file in Directory.GetFiles(folder)) File.SetAttributes(file, FileAttributes.Normal);
            Directory.Delete(folder, true);
        }

        /// <summary>Once per session, removes diff folders older than a day that a crash or VS restart left behind.</summary>
        private void SweepStaleFolders()
        {
            if (_swept) return;
            _swept = true;
            var root = DiffsRoot();
            string[] dirs;
            try
            {
                if (!Directory.Exists(root)) return;
                dirs = Directory.GetDirectories(root);
            }
            catch (Exception ex)
            {
                _log.Info($"Could not list old diff folders in {root}: {ex.Message}");
                return;
            }
            var cutoff = DateTime.UtcNow.AddDays(-1);
            foreach (var dir in dirs)
            {
                try
                {
                    if (Directory.GetLastWriteTimeUtc(dir) >= cutoff) continue;
                    DeleteFolder(dir);
                }
                catch (Exception ex)
                {
                    _log.Info($"Could not remove the old diff folder {dir}: {ex.Message}");
                }
            }
        }

        private static string DiffsRoot() => Path.Combine(Path.GetTempPath(), "VSClaudio", "diffs");

        private static string TempFolder(string id) => DiffPaths.FolderFor(DiffsRoot(), id);

        private sealed class InfoBarEvents : IVsInfoBarUIEvents
        {
            private readonly Action<string> _decided;

            public InfoBarEvents(Action<string> decided) => _decided = decided;

            public void OnActionItemClicked(IVsInfoBarUIElement infoBarUIElement, IVsInfoBarActionItem actionItem)
            {
                ThreadHelper.ThrowIfNotOnUIThread();
                if (actionItem.ActionContext is string decision) _decided(decision);
            }

            public void OnClosed(IVsInfoBarUIElement infoBarUIElement) { }
        }

        private sealed class FrameClosedNotify : IVsWindowFrameNotify
        {
            private readonly Action _closed;

            public FrameClosedNotify(Action closed) => _closed = closed;

            public int OnShow(int fShow)
            {
                if (fShow == (int)__FRAMESHOW.FRAMESHOW_WinClosed) _closed();
                return VSConstants.S_OK;
            }

            public int OnMove() => VSConstants.S_OK;
            public int OnSize() => VSConstants.S_OK;
            public int OnDockableChange(int fDockable) => VSConstants.S_OK;
        }
    }
}
