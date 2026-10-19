using System;
using System.IO;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using VSClaudio.Core;

namespace VSClaudio
{
    /// <summary>
    /// Saves an open, unsaved editor buffer so an edit applies to what the user sees.
    /// The bridge calls in under its lock from background threads, so this only schedules UI work and always calls done.
    /// </summary>
    internal sealed class EditorBuffers : IEditorBuffers
    {
        private readonly ILog _log;

        public EditorBuffers(ILog log) => _log = log;

        public void SaveIfDirty(string path, Action done)
        {
            try
            {
                ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
                {
                    try
                    {
                        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                        SaveOnUiThread(path);
                    }
                    catch (Exception ex)
                    {
                        _log.Info($"Could not save {path} before editing: {ex.Message}");
                    }
                    finally
                    {
                        Done(done);
                    }
                }).FileAndForget("VSClaudio/save");
            }
            catch (Exception ex)
            {
                // Scheduling failed, so the finally above never runs.
                _log.Info($"Could not save {path} before editing: {ex.Message}");
                Done(done);
            }
        }

        private void Done(Action done)
        {
            try
            {
                done?.Invoke();
            }
            catch (Exception ex)
            {
                _log.Info($"Edit continuation failed: {ex.Message}");
            }
        }

        private static void SaveOnUiThread(string path)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (string.IsNullOrEmpty(path)) return;
            var fullPath = Path.GetFullPath(path);
            var rdt = (IVsRunningDocumentTable)ServiceProvider.GlobalProvider.GetService(typeof(SVsRunningDocumentTable));
            if (rdt == null) return;

            foreach (var doc in new RunningDocumentTable(ServiceProvider.GlobalProvider))
            {
                if (!SamePath(doc.Moniker, fullPath)) continue;
                if (rdt is IVsRunningDocumentTable4 rdt4 && !rdt4.IsDocumentDirty(doc.DocCookie)) return;
                ErrorHandler.ThrowOnFailure(rdt.SaveDocuments(
                    (uint)__VSRDTSAVEOPTIONS.RDTSAVEOPT_SaveIfDirty, doc.Hierarchy, doc.ItemId, doc.DocCookie));
                return;
            }
        }

        private static bool SamePath(string moniker, string fullPath)
        {
            // Non-file monikers (designers, virtual documents) are not paths and never match.
            if (string.IsNullOrEmpty(moniker)) return false;
            try
            {
                return string.Equals(Path.GetFullPath(moniker), fullPath, StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException)
            {
                return false;
            }
        }
    }
}
