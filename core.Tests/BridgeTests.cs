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
        private readonly FakeReviewer _reviewer = new FakeReviewer();
        private readonly FakeBuffers _buffers = new FakeBuffers();
        private readonly Bridge _bridge;

        public BridgeTests()
        {
            _bridge = new Bridge(() => { var s = new FakeSidecar(); _sidecars.Add(s); return s; }, _web, _log, () => _workspace, _reviewer, _buffers);
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
        public void SecondWebviewReadyRepostsStatusAndTheme()
        {
            Ready();
            _bridge.PostTheme(new Dictionary<string, string> { ["--vsc-bg"] = "#000000" });
            Current.Emit("{\"t\":\"ready\",\"protocol\":1}");
            _web.Posted.Clear();

            Ready(); // the page reloaded

            Assert.Equal(new[] { "status", "theme" }, PostedTypes());
            Assert.Equal("connected", (string)PostedStatuses().Single()["state"]);
            Assert.Equal("#000000", (string)JObject.Parse(_web.Posted[1])["vars"]["--vsc-bg"]);
            Assert.Single(_sidecars);
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
        public void ReconnectMidTurnEndsTheTurnOnce()
        {
            Ready();
            _bridge.OnWebviewMessage("{\"t\":\"send\",\"text\":\"hi\"}");
            _bridge.OnWebviewMessage("{\"t\":\"reconnect\"}");
            var ended = _web.Posted.Select(JObject.Parse).Where(o => (string)o["t"] == "turn_end").ToList();
            Assert.Single(ended);
            Assert.Equal("interrupted", (string)ended[0]["status"]);
            Assert.Equal("Session restarted", (string)ended[0]["error"]);
            Current.Exit(0);
            Assert.Single(_web.Posted.Select(JObject.Parse), o => (string)o["t"] == "turn_end");
        }

        [Fact]
        public void NonStringFieldsDoNotThrow()
        {
            Ready();
            Current.Emit("{\"t\":\"session\",\"sessionId\":{\"x\":1}}");
            _bridge.OnWebviewMessage("{\"t\":\"send\",\"text\":[1]}");
            Assert.Equal("session", (string)JObject.Parse(_web.Posted.Last())["t"]);
            Assert.Single(Current.Sent);
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
        public void SwitchWorkspaceWithNoWorkspaceStopsTheSessionAndPostsNoWorkspace()
        {
            Ready();
            var first = Current;
            _workspace = null;
            _bridge.SwitchWorkspace();
            Assert.True(first.Stopped);
            Assert.Single(_sidecars);
            Assert.Equal("no_workspace", (string)PostedStatuses().Last()["state"]);
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

        private const string EditRequest = "{\"t\":\"permission_request\",\"id\":\"p1\",\"kind\":\"edit\",\"path\":\"C:\\\\src\\\\a.cs\",\"original\":\"old\",\"proposed\":\"new\",\"isNewFile\":false}";

        private void ConnectWithEditRequest()
        {
            Ready();
            Current.Emit(EditRequest);
        }

        [Fact]
        public void EditRequestOpensReviewerAndReachesWebview()
        {
            ConnectWithEditRequest();
            var open = Assert.Single(_reviewer.Opened);
            Assert.Equal(("p1", @"C:\src\a.cs", "old", "new", false), open);
            Assert.Equal(EditRequest, _web.Posted.Last());
        }

        [Fact]
        public void ToolRequestDoesNotOpenReviewer()
        {
            Ready();
            var line = "{\"t\":\"permission_request\",\"id\":\"p2\",\"kind\":\"tool\",\"toolName\":\"Bash\"}";
            Current.Emit(line);
            Assert.Empty(_reviewer.Opened);
            Assert.Equal(line, _web.Posted.Last());
        }

        [Fact]
        public void TooLargeEditDoesNotOpenReviewer()
        {
            Ready();
            var line = "{\"t\":\"permission_request\",\"id\":\"p3\",\"kind\":\"edit\",\"path\":\"x\",\"tooLarge\":true}";
            Current.Emit(line);
            Assert.Empty(_reviewer.Opened);
            Assert.Equal(line, _web.Posted.Last());
        }

        [Fact]
        public void WebviewResponseIsForwardedVerbatim()
        {
            Ready();
            var line = "{\"t\":\"permission_response\",\"id\":\"p1\",\"decision\":\"deny\",\"message\":\"no\"}";
            _bridge.OnWebviewMessage(line);
            Assert.Equal(line, Current.Sent.Last());
        }

        [Fact]
        public void SetModeIsForwardedVerbatim()
        {
            Ready();
            var line = "{\"t\":\"set_mode\",\"mode\":\"plan\"}";
            _bridge.OnWebviewMessage(line);
            Assert.Equal(line, Current.Sent.Last());
        }

        [Fact]
        public void ReviewerDecisionSendsResponseToSidecar()
        {
            ConnectWithEditRequest();
            _reviewer.Decide("p1", "allow");
            var sent = JObject.Parse(Current.Sent.Last());
            Assert.Equal("permission_response", (string)sent["t"]);
            Assert.Equal("p1", (string)sent["id"]);
            Assert.Equal("allow", (string)sent["decision"]);
        }

        [Fact]
        public void ReviewerDecisionForUnknownIdIsIgnored()
        {
            ConnectWithEditRequest();
            var before = Current.Sent.Count;
            _reviewer.Decide("nope", "allow");
            Assert.Equal(before, Current.Sent.Count);
        }

        [Fact]
        public void ResolvedClosesReviewerAndForwards()
        {
            ConnectWithEditRequest();
            var line = "{\"t\":\"permission_resolved\",\"id\":\"p1\",\"outcome\":\"allowed\"}";
            Current.Emit(line);
            Assert.Equal(new[] { "p1" }, _reviewer.Closed);
            Assert.Equal(line, _web.Posted.Last());
            var before = Current.Sent.Count;
            _reviewer.Decide("p1", "allow"); // no longer pending
            Assert.Equal(before, Current.Sent.Count);
        }

        [Fact]
        public void OpenDiffReopensPendingEdit()
        {
            ConnectWithEditRequest();
            _bridge.OnWebviewMessage("{\"t\":\"open_diff\",\"id\":\"p1\"}");
            Assert.Equal(2, _reviewer.Opened.Count);
            Assert.Equal(_reviewer.Opened[0], _reviewer.Opened[1]);
            _bridge.OnWebviewMessage("{\"t\":\"open_diff\",\"id\":\"unknown\"}");
            Assert.Equal(2, _reviewer.Opened.Count);
        }

        [Fact]
        public void PrepareEditSavesThenAcksAndIsNotForwarded()
        {
            Ready();
            var before = _web.Posted.Count;
            Current.Emit("{\"t\":\"prepare_edit\",\"id\":\"e1\",\"path\":\"C:\\\\src\\\\a.cs\"}");
            Assert.Equal(new[] { @"C:\src\a.cs" }, _buffers.Saved);
            Assert.Equal(before, _web.Posted.Count);
            Assert.DoesNotContain(Current.Sent, l => l.Contains("edit_prepared"));
            _buffers.CompleteAll();
            var ack = JObject.Parse(Current.Sent.Last());
            Assert.Equal("edit_prepared", (string)ack["t"]);
            Assert.Equal("e1", (string)ack["id"]);
        }

        [Fact]
        public void PrepareEditAckSkippedAfterSidecarReplaced()
        {
            Ready();
            var first = Current;
            first.Emit("{\"t\":\"prepare_edit\",\"id\":\"e1\",\"path\":\"a\"}");
            _bridge.Reconnect();
            _buffers.CompleteAll();
            Assert.DoesNotContain(first.Sent, l => l.Contains("edit_prepared"));
            Assert.DoesNotContain(Current.Sent, l => l.Contains("edit_prepared"));
        }

        [Fact]
        public void ExitCancelsPendingRequests()
        {
            ConnectWithEditRequest();
            var sent = Current.Sent.Count;
            Current.Exit(1);
            var cancelled = _web.Posted.Select(JObject.Parse).Single(o => (string)o["t"] == "permission_resolved");
            Assert.Equal("p1", (string)cancelled["id"]);
            Assert.Equal("cancelled", (string)cancelled["outcome"]);
            Assert.Equal(new[] { "p1" }, _reviewer.Closed);
            _reviewer.Decide("p1", "allow"); // cleared, so nothing is sent
            Assert.Equal(sent, Current.Sent.Count);
        }

        [Fact]
        public void NewSessionCancelsPendingRequests()
        {
            ConnectWithEditRequest();
            _bridge.OnWebviewMessage("{\"t\":\"new_session\"}");
            var cancelled = _web.Posted.Select(JObject.Parse).Single(o => (string)o["t"] == "permission_resolved");
            Assert.Equal("cancelled", (string)cancelled["outcome"]);
            Assert.Equal(new[] { "p1" }, _reviewer.Closed);
        }

        [Fact]
        public void ReconnectCancelsPendingRequests()
        {
            ConnectWithEditRequest();
            _bridge.Reconnect();
            Assert.Equal(1, _web.Posted.Count(p => p.Contains("\"cancelled\"")));
            Assert.Equal(new[] { "p1" }, _reviewer.Closed);
        }

        [Fact]
        public void NullReviewerAndBuffersAreTolerated()
        {
            var sidecars = new List<FakeSidecar>();
            var bridge = new Bridge(() => { var s = new FakeSidecar(); sidecars.Add(s); return s; }, _web, _log, () => _workspace, null, null);
            bridge.OnWebviewMessage("{\"t\":\"webview_ready\"}");
            var s0 = sidecars[0];
            s0.Emit(EditRequest);
            bridge.OnWebviewMessage("{\"t\":\"open_diff\",\"id\":\"p1\"}");
            s0.Emit("{\"t\":\"prepare_edit\",\"id\":\"e1\",\"path\":\"a\"}");
            Assert.Equal("edit_prepared", (string)JObject.Parse(s0.Sent.Last())["t"]);
            s0.Emit("{\"t\":\"permission_resolved\",\"id\":\"p1\",\"outcome\":\"allowed\"}");
            s0.Emit(EditRequest);
            bridge.Dispose();
        }
    }
}
