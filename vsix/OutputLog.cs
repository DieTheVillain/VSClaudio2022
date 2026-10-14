using System;
using System.Threading.Tasks;
using Community.VisualStudio.Toolkit;
using Microsoft.VisualStudio.Shell;
using VSClaudio.Core;

namespace VSClaudio
{
    internal sealed class OutputLog : ILog
    {
        private readonly OutputWindowPane _pane;

        private OutputLog(OutputWindowPane pane) => _pane = pane;

        public static async Task<OutputLog> CreateAsync() => new OutputLog(await VS.Windows.CreateOutputWindowPaneAsync("VSClaudio"));

        public void Info(string message) => _pane.WriteLineAsync($"{DateTime.Now:HH:mm:ss} {message}").FireAndForget();
    }
}
