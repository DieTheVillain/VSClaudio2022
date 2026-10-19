using System;
using System.IO;

namespace VSClaudio.Core
{
    /// <summary>
    /// Maps a review id to its temp folder under the diffs root. Ids come from the SDK and are not trusted as path segments,
    /// and the folder is deleted recursively later, so it must always be a strict child of the root.
    /// </summary>
    public static class DiffPaths
    {
        public static string FolderFor(string root, string id)
        {
            var safe = id ?? "";
            foreach (var c in Path.GetInvalidFileNameChars()) safe = safe.Replace(c, '_');
            // Windows drops trailing spaces and dots from a path segment, so ".." or "x. " would normalise to the parent or another id.
            safe = safe.Trim().TrimEnd(' ', '.');
            if (safe.Length == 0) safe = "_";
            var folder = Path.GetFullPath(Path.Combine(root, safe));
            if (!IsStrictlyUnder(root, folder)) throw new ArgumentException($"The diff folder for id '{id}' is not under {root}.", nameof(id));
            return folder;
        }

        public static bool IsStrictlyUnder(string root, string path)
        {
            if (string.IsNullOrEmpty(root) || string.IsNullOrEmpty(path)) return false;
            try
            {
                var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
                var full = Path.GetFullPath(path);
                return full.Length > prefix.Length && full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException)
            {
                return false;
            }
        }
    }
}
