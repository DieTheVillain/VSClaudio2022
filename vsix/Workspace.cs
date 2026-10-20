using System;
using System.IO;
using System.Threading.Tasks;
using Community.VisualStudio.Toolkit;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace VSClaudio
{
    internal static class Workspace
    {
        /// <summary>The open solution's folder, the open folder, or the active document's folder; null if none.</summary>
        public static async Task<string> ResolveAsync()
        {
            var openFolder = await OpenSolutionDirectoryAsync();
            if (openFolder != null) return openFolder;

            var solution = await VS.Solutions.GetCurrentSolutionAsync();
            var path = solution?.FullPath;
            if (!string.IsNullOrEmpty(path))
            {
                if (Directory.Exists(path)) return path;
                if (File.Exists(path)) return Path.GetDirectoryName(path);
            }

            var doc = await VS.Documents.GetActiveDocumentViewAsync();
            var file = doc?.FilePath;
            return string.IsNullOrEmpty(file) ? null : Path.GetDirectoryName(file);
        }

        /// <summary>
        /// The folder VS has open. In Open Folder mode there is no solution file, so the toolkit's Solution.FullPath is
        /// empty; IVsSolution still reports the opened folder as the solution directory.
        /// </summary>
        private static async Task<string> OpenSolutionDirectoryAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            var vsSolution = await VS.Services.GetSolutionAsync();
            if (vsSolution == null) return null;

            if (vsSolution.GetSolutionInfo(out var dir, out _, out _) == 0 && !string.IsNullOrEmpty(dir) && Directory.Exists(dir))
                return dir;

            if (vsSolution.GetProperty((int)__VSPROPID.VSPROPID_SolutionDirectory, out var value) == 0
                && value is string propDir && propDir.Length > 0 && Directory.Exists(propDir))
                return propDir;

            return null;
        }

        public static bool SameFolder(string a, string b) =>
            string.Equals(Path.GetFullPath(a ?? ".").TrimEnd('\\'), Path.GetFullPath(b ?? ".").TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }
}
