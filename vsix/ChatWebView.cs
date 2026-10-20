using System.Windows.Input;
using Microsoft.Web.WebView2.Wpf;

namespace VSClaudio
{
    /// <summary>
    /// WebView2 that keeps text navigation and editing keys inside the page.
    /// </summary>
    /// <remarks>
    /// Keys typed into the browser never reach Visual Studio's message loop. WebView2 instead reports
    /// non-character keys (Home, End, Delete, arrows, anything with Ctrl) through AcceleratorKeyPressed,
    /// and the WPF control replays them as PreviewKeyDown followed by a bubbling KeyDown. If any WPF
    /// ancestor marks that KeyDown handled, the browser drops the key. The docking tab groups that host
    /// tool windows derive from TabControl, whose OnKeyDown treats Home and End as "select first/last tab",
    /// so End in the composer switched documents and Home was swallowed. For the keys below we skip the
    /// bubbling KeyDown/KeyUp and leave the event unhandled, so the page receives them. Every other key
    /// keeps the default path, so Ctrl+Tab, F-keys and Alt shortcuts still reach Visual Studio.
    /// </remarks>
    internal sealed class ChatWebView : WebView2
    {
        protected override void OnPreviewKeyDown(KeyEventArgs e)
        {
            if (!IsTextEditingKey(e)) base.OnPreviewKeyDown(e);
        }

        protected override void OnPreviewKeyUp(KeyEventArgs e)
        {
            if (!IsTextEditingKey(e)) base.OnPreviewKeyUp(e);
        }

        private static bool IsTextEditingKey(KeyEventArgs e)
        {
            // Alt combinations arrive as Key.System and are left to Visual Studio's menus.
            if ((e.KeyboardDevice.Modifiers & ModifierKeys.Alt) != 0) return false;
            switch (e.Key)
            {
                case Key.Home:
                case Key.End:
                case Key.Left:
                case Key.Right:
                case Key.Up:
                case Key.Down:
                case Key.Delete:
                case Key.Back:
                    return true;
                case Key.PageUp:
                case Key.PageDown:
                    // Ctrl+PageUp/PageDown stays with Visual Studio for switching tabs.
                    return (e.KeyboardDevice.Modifiers & ModifierKeys.Control) == 0;
                default:
                    return false;
            }
        }
    }
}
