using Community.VisualStudio.Toolkit;
using Microsoft.VisualStudio.Shell;
using Task = System.Threading.Tasks.Task;

namespace VSClaudio
{
    [Command(PackageGuids.CmdSetString, PackageIds.OpenChat)]
    internal sealed class OpenChatCommand : BaseCommand<OpenChatCommand>
    {
        protected override Task ExecuteAsync(OleMenuCmdEventArgs e) => ChatToolWindow.ShowAsync();
    }
}
