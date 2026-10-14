using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using Xunit;

namespace VSClaudio.Core.Tests
{
    public class BridgeTests
    {
        private readonly List<FakeSidecar> _sidecars = new List<FakeSidecar>();
        private readonly FakePoster _web = new FakePoster();
        private readonly FakeLog _log = new FakeLog();
        private string _workspace = @"C:\src\App";
        private readonly Bridge _bridge;

        public BridgeTests()
        {
            _bridge = new Bridge(() => { var s = new FakeSidecar(); _sidecars.Add(s); return s; }, _web, _log, () => _workspace);
        }

        private FakeSidecar Current => _sidecars.Last();
        private List<string> PostedTypes() => _web.Posted.Select(p => (string)JObject.Parse(p)["t"]).ToList();
        private List<JObject> PostedStatuses() => _web.Posted.Select(JObject.Parse).Where(o => (string)o["t"] == "status").ToList();
        private void Ready() => _bridge.OnWebviewMessage("{\"t\":\"webview_ready\"}");

        [Fact]
        public void WebviewReadyStartsSidecarAndSendsHello()
        {
            Ready();
            Assert.True(Current.Started);
            var hello = JObject.Parse(Current.Sent[0]);
            Assert.Equal("hello", (string)hello["t"]);
            Assert.Equal(@"C:\src\App", (string)hello["cwd"]);
            Assert.Null(hello["resume"]);
            Assert.Equal("starting", (string)PostedStatuses().Last()["state"]);
        }

        [Fact]
        public void BuffersUntilWebviewReady()
        {
            _bridge.PostTheme(new Dictionary<string, string> { ["--vsc-bg"] = "#000000" });
            _bridge.Reconnect();
            Current.Emit("{\"t\":\"ready\",\"protocol\":1}");
            Current.Emit("{\"t\":\"session\",\"sessionId\":\"s1\",\"model\":\"m\",\"cwd\":\"c\"}");
            Assert.Empty(_web.Posted);
            Ready();
            Assert.Equal(new[] { "theme", "status", "status", "ready", "session" }, PostedTypes());
            Assert.Single(_sidecars); // already connected: webview_ready must not start a second sidecar
        }

        [Fact]
        public void ReadyPostsConnected()
        {
            Ready();
            Current.Emit("{\"t\":\"ready\",\"protocol\":1}");
            Assert.Equal("connected", _bridge.State);
            Assert.Equal("connected", (string)PostedStatuses().Last()["state"]);
        }

        [Fact]
        public void SendIsForwardedAndBlankSendIgnored()
        {
            Ready();
            _bridge.OnWebviewMessage("{\"t\":\"send\",\"text\":\"  \"}");
            _bridge.OnWebviewMessage("{\"t\":\"send\",\"text\":\"hi 🚀\"}");
            Assert.Equal(2, Current.Sent.Count);
            Assert.Equal("hi 🚀", (string)JObject.Parse(Current.Sent[1])["text"]);
        }

        [Fact]
        public void ReconnectResumesLastSession()
        {
            Ready();
            Current.Emit("{\"t\":\"session\",\"sessionId\":\"s42\",\"model\":\"m\",\"cwd\":\"c\"}");
            Current.Exit(1);
            _bridge.OnWebviewMessage("{\"t\":\"reconnect\"}");
            Assert.Equal(2, _sidecars.Count);
            Assert.Equal("s42", (string)JObject.Parse(Current.Sent[0])["resume"]);
        }

        [Fact]
        public void NewSessionForgetsSessionId()
        {
            Ready();
            Current.Emit("{\"t\":\"session\",\"sessionId\":\"s42\",\"model\":\"m\",\"cwd\":\"c\"}");
            _bridge.OnWebviewMessage("{\"t\":\"new_session\"}");
            Assert.Equal("new_session", (string)JObject.Parse(Current.Sent.Last())["t"]);
            _bridge.OnWebviewMessage("{\"t\":\"reconnect\"}");
            Assert.Null(JObject.Parse(Current.Sent[0])["resume"]);
        }

        [Fact]
        public void ExitMidTurnPostsInterruptedThenDisconnected()
        {
            Ready();
            _bridge.OnWebviewMessage("{\"t\":\"send\",\"text\":\"hi\"}");
            Current.Exit(3);
            var last = _web.Posted.Skip(_web.Posted.Count - 2).Select(JObject.Parse).ToList();
            Assert.Equal("turn_end", (string)last[0]["t"]);
            Assert.Equal("interrupted", (string)last[0]["status"]);
            Assert.Equal("disconnected", (string)last[1]["state"]);
            Assert.Equal("exit code 3", (string)last[1]["detail"]);
        }

        [Fact]
        public void ExitAfterTurnEndDoesNotPostTurnEnd()
        {
            Ready();
            _bridge.OnWebviewMessage("{\"t\":\"send\",\"text\":\"hi\"}");
            Current.Emit("{\"t\":\"turn_end\",\"status\":\"success\"}");
            Current.Exit(0);
            Assert.Single(_web.Posted.Select(JObject.Parse), o => (string)o["t"] == "turn_end");
        }

        [Fact]
        public void NoWorkspacePostsNoWorkspace()
        {
            _workspace = null;
            Ready();
            Assert.Empty(_sidecars);
            Assert.Equal("no_workspace", (string)PostedStatuses().Last()["state"]);
        }

        [Fact]
        public void StaleSidecarIsIgnored()
        {
            Ready();
            var first = Current;
            _bridge.Reconnect();
            Assert.True(first.Stopped);
            Assert.Equal("shutdown", (string)JObject.Parse(first.Sent.Last())["t"]);
            var before = _web.Posted.Count;
            first.Emit("{\"t\":\"ready\",\"protocol\":1}");
            first.Exit(1);
            Assert.Equal(before, _web.Posted.Count);
        }

        [Fact]
        public void MalformedSidecarLineIsLoggedNotPosted()
        {
            Ready();
            var before = _web.Posted.Count;
            Current.Emit("Debugger attached.");
            Assert.Equal(before, _web.Posted.Count);
            Assert.Contains(_log.Lines, l => l.Contains("Debugger attached."));
        }

        [Fact]
        public void ChooseFolderRaisesEvent()
        {
            var raised = 0;
            _bridge.ChooseFolderRequested += () => raised++;
            _bridge.OnWebviewMessage("{\"t\":\"choose_folder\"}");
            Assert.Equal(1, raised);
        }

        [Fact]
        public void ThemeIsPostedOnlyWhenChanged()
        {
            Ready();
            var vars = new Dictionary<string, string> { ["--vsc-bg"] = "#000000" };
            _bridge.PostTheme(vars);
            _bridge.PostTheme(new Dictionary<string, string>(vars));
            _bridge.PostTheme(new Dictionary<string, string> { ["--vsc-bg"] = "#FFFFFF" });
            Assert.Equal(2, PostedTypes().Count(t => t == "theme"));
        }

        [Fact]
        public void SwitchWorkspaceStartsAFreshSessionInTheNewFolder()
        {
            Ready();
            Current.Emit("{\"t\":\"session\",\"sessionId\":\"s42\",\"model\":\"m\",\"cwd\":\"c\"}");
            _workspace = @"D:\Other";
            _bridge.SwitchWorkspace();
            var hello = JObject.Parse(Current.Sent[0]);
            Assert.Equal(2, _sidecars.Count);
            Assert.Equal(@"D:\Other", (string)hello["cwd"]);
            Assert.Null(hello["resume"]);
            var status = PostedStatuses().Last(o => (string)o["state"] == "starting");
            Assert.Equal("workspace_changed", (string)status["detail"]);
        }

        [Fact]
        public void DisposeShutsDownSidecar()
        {
            Ready();
            var s = Current;
            _bridge.Dispose();
            Assert.True(s.Stopped);
            Assert.Equal("shutdown", (string)JObject.Parse(s.Sent.Last())["t"]);
        }
    }
}
