using System;
using System.Collections.Generic;

namespace VSClaudio.Core.Tests
{
    internal sealed class FakeSidecar : ISidecar
    {
        public readonly List<string> Sent = new List<string>();
        public bool Started, Stopped;
        public event Action<string> LineReceived;
        public event Action<int> Exited;
        public void Start() => Started = true;
        public void Send(string line) => Sent.Add(line);
        public void Stop() => Stopped = true;
        public void Emit(string line) => LineReceived?.Invoke(line);
        public void Exit(int code) => Exited?.Invoke(code);
    }

    internal sealed class FakePoster : IWebviewPoster
    {
        public readonly List<string> Posted = new List<string>();
        public void Post(string json) => Posted.Add(json);
    }

    internal sealed class FakeLog : ILog
    {
        public readonly List<string> Lines = new List<string>();
        public void Info(string message) => Lines.Add(message);
    }
}
