using System;
using System.Runtime.InteropServices;
using System.Threading;
using Community.VisualStudio.Toolkit;
using Microsoft.VisualStudio.Shell;
using Task = System.Threading.Tasks.Task;

[assembly: ProvideCodeBase(AssemblyName = "VSClaudio.Core", Version = "1.0.0.0", CodeBase = @"$PackageFolder$\VSClaudio.Core.dll")]

namespace VSClaudio
{
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("VSClaudio", "Claude Code chat panel for Visual Studio", "0.1.0")]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideToolWindow(typeof(ChatToolWindow.Pane), Style = VsDockStyle.Tabbed, Window = WindowGuids.SolutionExplorer)]
    [Guid(PackageGuids.PackageString)]
    public sealed class VSClaudioPackage : ToolkitPackage
    {
        // Registration only. Showing a tool window from here deadlocks package load.
        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            await this.RegisterCommandsAsync();
            this.RegisterToolWindows();
        }
    }
}
