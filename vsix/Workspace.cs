using System;
using System.IO;
using System.Threading.Tasks;
using Community.VisualStudio.Toolkit;

namespace VSClaudio
{
    internal static class Workspace
    {
        /// <summary>The open solution's folder, the open folder, or the active document's folder; null if none.</summary>
        public static async Task<string> ResolveAsync()
        {
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

        public static bool SameFolder(string a, string b) =>
            string.Equals(Path.GetFullPath(a ?? ".").TrimEnd('\\'), Path.GetFullPath(b ?? ".").TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }
}
