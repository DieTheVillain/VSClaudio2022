using System.Collections.Generic;
using System.Drawing;
using Microsoft.VisualStudio.PlatformUI;
using Microsoft.VisualStudio.Shell;

namespace VSClaudio
{
    /// <summary>Maps the current VS theme onto the webview's --vsc-* CSS variables.</summary>
    internal static class ThemeVars
    {
        public static Dictionary<string, string> Current()
        {
            var bg = Color(EnvironmentColors.ToolWindowBackgroundColorKey);
            var fg = Color(EnvironmentColors.ToolWindowTextColorKey);
            return new Dictionary<string, string>
            {
                ["--vsc-bg"] = Hex(bg),
                ["--vsc-fg"] = Hex(fg),
                ["--vsc-muted"] = Hex(Blend(fg, bg, 0.4)),
                ["--vsc-raised"] = Hex(Blend(bg, fg, 0.06)),
                ["--vsc-border"] = Hex(Color(EnvironmentColors.ToolWindowBorderColorKey)),
                ["--vsc-input-bg"] = Hex(Color(CommonControlsColors.TextBoxBackgroundColorKey)),
                ["--vsc-input-border"] = Hex(Color(CommonControlsColors.TextBoxBorderColorKey)),
                ["--vsc-accent"] = Hex(Color(EnvironmentColors.SystemHighlightColorKey)),
                ["--vsc-link"] = Hex(Color(EnvironmentColors.ControlLinkTextColorKey)),
            };
        }

        private static Color Color(ThemeResourceKey key) => VSColorTheme.GetThemedColor(key);

        private static string Hex(Color c) => $"#{c.R:X2}{c.G:X2}{c.B:X2}";

        private static Color Blend(Color from, Color to, double amount) => System.Drawing.Color.FromArgb(
            (int)(from.R + (to.R - from.R) * amount),
            (int)(from.G + (to.G - from.G) * amount),
            (int)(from.B + (to.B - from.B) * amount));
    }
}
