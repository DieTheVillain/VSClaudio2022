using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace VSClaudio.Core
{
    /// <summary>
    /// Routes messages between the chat webview and the sidecar process and tracks connection state.
    /// Sidecar events are forwarded verbatim; the bridge only reads the fields it needs.
    /// </summary>
    public sealed class Bridge : IDisposable
    {
        private readonly object _gate = new object();
        private readonly Func<ISidecar> _sidecarFactory;
        private readonly IWebviewPoster _web;
        private readonly ILog _log;
        private readonly Func<string> _workspace;
        private readonly IEditReviewer _reviewer;
        private readonly IEditorBuffers _buffers;
        private readonly List<string> _pending = new List<string>();
        // Permission requests awaiting a decision, keyed by request id; holds the sidecar's original message.
        private readonly Dictionary<string, JObject> _pendingRequests = new Dictionary<string, JObject>();

        private ISidecar _sidecar;
        private bool _webReady;
        private string _sessionId;
        private bool _turnRunning;
        private string _lastTheme;

        public Bridge(Func<ISidecar> sidecarFactory, IWebviewPoster web, ILog log, Func<string> workspace, IEditReviewer reviewer, IEditorBuffers buffers)
        {
            _sidecarFactory = sidecarFactory;
            _web = web;
            _log = log;
            _workspace = workspace;
            _reviewer = reviewer;
            _buffers = buffers;
            if (_reviewer != null) _reviewer.Decided += OnReviewerDecided;
        }

        public string State { get; private set; } = "idle";

        public event Action ChooseFolderRequested;

        public void OnWebviewMessage(string json)
        {
            var message = Protocol.TryParse(json);
            if (message == null)
            {
                _log.Info("Ignored malformed webview message.");
                return;
            }

            Action raise = null;
            lock (_gate)
            {
                switch (Protocol.TypeOf(message))
                {
                    case "webview_ready":
                        // A repeat means the page reloaded (or its renderer was restarted) and lost its state.
                        var reloaded = _webReady;
                        _webReady = true;
                        foreach (var p in _pending) _web.Post(p);
                        _pending.Clear();
                        if (_sidecar == null) ConnectLocked(_sessionId);
                        else if (reloaded) _web.Post(Protocol.Status(State));
                        if (reloaded && _lastTheme != null) _web.Post(_lastTheme);
                        break;
                    case "send":
                        var text = Str(message, "text");
                        if (_sidecar != null && !string.IsNullOrWhiteSpace(text))
                        {
                            _turnRunning = true;
                            _sidecar.Send(Protocol.Send(text));
                        }
                        break;
                    case "interrupt":
                        _sidecar?.Send(Protocol.Simple("interrupt"));
                        break;
                    case "new_session":
                        _sessionId = null;
                        _turnRunning = false;
                        CancelPendingRequestsLocked();
                        _sidecar?.Send(Protocol.Simple("new_session"));
                        break;
                    case "permission_response":
                    case "set_mode":
                        // The sidecar owns the schema; pass the webview's line through unchanged.
                        _sidecar?.Send(json);
                        break;
                    case "open_diff":
                        var requestId = Str(message, "id");
                        if (requestId != null && _pendingRequests.TryGetValue(requestId, out var request)) OpenReviewLocked(requestId, request);
                        break;
                    case "reconnect":
                        ConnectLocked(_sessionId);
                        break;
                    case "choose_folder":
                        raise = ChooseFolderRequested;
                        break;
                    default:
                        _log.Info($"Ignored webview message '{Protocol.TypeOf(message)}'.");
                        break;
                }
            }

            // Raised outside the lock: the handler shows a modal dialog and then calls Reconnect().
            raise?.Invoke();
        }

        public void Reconnect()
        {
            lock (_gate) ConnectLocked(_sessionId);
        }

        /// <summary>True while the panel is showing "no workspace", so a workspace that appears must start a session.</summary>
        public bool NeedsWorkspace
        {
            get { lock (_gate) return State == "no_workspace"; }
        }

        public void SwitchWorkspace()
        {
            lock (_gate)
            {
                _sessionId = null;
                _turnRunning = false;
                ConnectLocked(null, "workspace_changed");
            }
        }

        public void PostTheme(IDictionary<string, string> vars)
        {
            var json = Protocol.Theme(vars);
            lock (_gate)
            {
                if (json == _lastTheme) return;
                _lastTheme = json;
                PostLocked(json);
            }
        }

        public void Dispose()
        {
            lock (_gate) StopLocked();
        }

        private void ConnectLocked(string resume, string startingDetail = null)
        {
            StopLocked();
            var cwd = _workspace();
            if (string.IsNullOrEmpty(cwd))
            {
                SetStateLocked("no_workspace");
                return;
            }

            var sidecar = _sidecarFactory();
            _sidecar = sidecar;
            sidecar.LineReceived += line => OnSidecarLine(sidecar, line);
            sidecar.Exited += code => OnSidecarExited(sidecar, code);
            SetStateLocked("starting", startingDetail);
            try
            {
                sidecar.Start();
            }
            catch (Exception ex)
            {
                _log.Info("Failed to start the sidecar: " + ex.Message);
                _sidecar = null;
                SetStateLocked("disconnected", ex.Message);
                return;
            }
            sidecar.Send(Protocol.Hello(cwd, null, resume));
        }

        private void OnReviewerDecided(string id, string decision)
        {
            lock (_gate)
            {
                // The sidecar answers with permission_resolved, which closes the tab and updates the card.
                if (id == null || _sidecar == null || !_pendingRequests.ContainsKey(id)) return;
                _sidecar.Send(Protocol.PermissionResponse(id, decision));
            }
        }

        private void OpenReviewLocked(string id, JObject request)
        {
            if (_reviewer == null) return;
            if (Str(request, "kind") != "edit" || (bool?)request["tooLarge"] == true) return;
            _reviewer.Open(id, Str(request, "path"), Str(request, "original"), Str(request, "proposed"), (bool?)request["isNewFile"] == true);
        }

        // Tells the webview and the diff tab that requests the sidecar can no longer answer are cancelled.
        private void CancelPendingRequestsLocked()
        {
            if (_pendingRequests.Count == 0) return;
            var ids = new List<string>(_pendingRequests.Keys);
            _pendingRequests.Clear();
            foreach (var id in ids)
            {
                PostLocked(Protocol.PermissionResolved(id, "cancelled"));
                _reviewer?.Close(id);
            }
        }

        private void OnEditPrepared(ISidecar sidecar, string id)
        {
            lock (_gate)
            {
                if (sidecar != _sidecar) return;
                sidecar.Send(Protocol.EditPrepared(id));
            }
        }

        private void OnSidecarLine(ISidecar sidecar, string line)
        {
            Action afterLock = null;
            var forward = true;
            lock (_gate)
            {
                if (sidecar != _sidecar) return;
                var message = Protocol.TryParse(line);
                if (message == null)
                {
                    _log.Info("sidecar: " + line);
                    return;
                }

                switch (Protocol.TypeOf(message))
                {
                    case "ready":
                        SetStateLocked("connected");
                        break;
                    case "session":
                        _sessionId = Str(message, "sessionId");
                        break;
                    case "turn_end":
                        _turnRunning = false;
                        break;
                    case "error":
                        _turnRunning = false;
                        _log.Info($"Sidecar error {Str(message, "code")}: {Str(message, "message")}");
                        break;
                    case "permission_request":
                        var requestId = Str(message, "id");
                        if (requestId != null)
                        {
                            _pendingRequests[requestId] = message;
                            OpenReviewLocked(requestId, message);
                        }
                        break;
                    case "permission_resolved":
                        var resolvedId = Str(message, "id");
                        if (resolvedId != null && _pendingRequests.Remove(resolvedId)) _reviewer?.Close(resolvedId);
                        break;
                    case "prepare_edit":
                        // Host-only handshake: save the buffer (outside the lock), then acknowledge.
                        var editId = Str(message, "id");
                        var editPath = Str(message, "path");
                        afterLock = () =>
                        {
                            if (_buffers == null) OnEditPrepared(sidecar, editId);
                            else _buffers.SaveIfDirty(editPath, () => OnEditPrepared(sidecar, editId));
                        };
                        forward = false;
                        break;
                }
                if (forward) PostLocked(line);
            }

            afterLock?.Invoke();
        }

        private void OnSidecarExited(ISidecar sidecar, int code)
        {
            lock (_gate)
            {
                if (sidecar != _sidecar) return;
                _sidecar = null;
                _log.Info($"Sidecar exited with code {code}.");
                CancelPendingRequestsLocked();
                if (_turnRunning)
                {
                    _turnRunning = false;
                    PostLocked(Protocol.TurnEnd("interrupted", "Session disconnected"));
                }
                SetStateLocked("disconnected", $"exit code {code}");
            }
        }

        private void StopLocked()
        {
            CancelPendingRequestsLocked();
            if (_sidecar == null) return;
            var sidecar = _sidecar;
            _sidecar = null;
            try { sidecar.Send(Protocol.Simple("shutdown")); }
            catch (Exception ex) { _log.Info("Shutdown send failed: " + ex.Message); }
            sidecar.Stop();

            // The replaced sidecar's exit is ignored as stale, so end its turn here or the panel would keep it running.
            if (_turnRunning)
            {
                _turnRunning = false;
                PostLocked(Protocol.TurnEnd("interrupted", "Session restarted"));
            }
        }

        private static string Str(JObject message, string key) => (message[key] as JValue)?.Value as string;

        private void SetStateLocked(string state, string detail = null)
        {
            State = state;
            PostLocked(Protocol.Status(state, detail));
        }

        private void PostLocked(string json)
        {
            if (_webReady) _web.Post(json);
            else _pending.Add(json);
        }
    }
}
