using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Community.VisualStudio.Toolkit;

namespace VSClaudio
{
    public class ChatToolWindow : BaseToolWindow<ChatToolWindow>
    {
        public override string GetTitle(int toolWindowId) => "VSClaudio";

        public override Type PaneType => typeof(Pane);

        public override Task<FrameworkElement> CreateAsync(int toolWindowId, CancellationToken cancellationToken)
            => Task.FromResult<FrameworkElement>(new ChatControl());

        [Guid("6c2e9f1a-8b4d-4c37-a1e5-3d9f0b7c2e84")]
        internal class Pane : ToolkitToolWindowPane
        {
            public Pane()
            {
                BitmapImageMoniker = ImageIds.Chat;
            }
        }
    }
}
