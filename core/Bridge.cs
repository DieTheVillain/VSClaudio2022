using System;
using System.Collections.Generic;

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
        private readonly List<string> _pending = new List<string>();

        private ISidecar _sidecar;
        private bool _webReady;
        private string _sessionId;
        private bool _turnRunning;
        private string _lastTheme;

        public Bridge(Func<ISidecar> sidecarFactory, IWebviewPoster web, ILog log, Func<string> workspace)
        {
            _sidecarFactory = sidecarFactory;
            _web = web;
            _log = log;
            _workspace = workspace;
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
                        _webReady = true;
                        foreach (var p in _pending) _web.Post(p);
                        _pending.Clear();
                        if (_sidecar == null) ConnectLocked(_sessionId);
                        break;
                    case "send":
                        var text = (string)message["text"];
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
                        _sidecar?.Send(Protocol.Simple("new_session"));
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

        private void OnSidecarLine(ISidecar sidecar, string line)
        {
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
                        _sessionId = (string)message["sessionId"];
                        break;
                    case "turn_end":
                        _turnRunning = false;
                        break;
                    case "error":
                        _turnRunning = false;
                        _log.Info($"Sidecar error {message["code"]}: {message["message"]}");
                        break;
                }
                PostLocked(line);
            }
        }

        private void OnSidecarExited(ISidecar sidecar, int code)
        {
            lock (_gate)
            {
                if (sidecar != _sidecar) return;
                _sidecar = null;
                _log.Info($"Sidecar exited with code {code}.");
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
            if (_sidecar == null) return;
            var sidecar = _sidecar;
            _sidecar = null;
            try { sidecar.Send(Protocol.Simple("shutdown")); }
            catch (Exception ex) { _log.Info("Shutdown send failed: " + ex.Message); }
            sidecar.Stop();
        }

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
