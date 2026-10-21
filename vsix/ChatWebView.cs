using System.Windows.Input;
using Microsoft.Web.WebView2.Wpf;

namespace VSClaudio
{
    /// <summary>
    /// WebView2 that keeps text navigation and editing keys inside the page.
    /// </summary>
    /// <remarks>
    /// Keys typed into the browser never reach Visual Studio's message loop. WebView2 instead reports
    /// non-character keys (Home, End, Delete, arrows, anything with Ctrl) through AcceleratorKeyPressed.
    /// The WPF control raises a PreviewKeyDown (or PreviewKeyUp) on itself with those event args and
    /// copies the args' Handled flag back, so a handled key is withheld from the browser. Its
    /// OnPreviewKeyDown/OnPreviewKeyUp override then re-raises the same args as a bubbling KeyDown/KeyUp,
    /// and any WPF ancestor that marks that bubbling event handled makes the browser drop the key. The
    /// docking tab groups that host tool windows derive from TabControl, whose OnKeyDown treats Home and
    /// End as "select first/last tab", so End in the composer switched documents and Home was swallowed.
    /// For the keys below this class overrides OnPreviewKeyDown/OnPreviewKeyUp without calling the base,
    /// so the bubbling KeyDown/KeyUp is never raised, the args stay unhandled and the page receives the
    /// key. Ancestors still see the tunnelling PreviewKeyDown/PreviewKeyUp. Every other key keeps the
    /// default path, so Ctrl+Tab, F-keys and Alt shortcuts still reach Visual Studio.
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
