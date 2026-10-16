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

    internal sealed class FakeReviewer : IEditReviewer
    {
        public readonly List<(string Id, string Path, string Original, string Proposed, bool IsNew)> Opened = new List<(string, string, string, string, bool)>();
        public readonly List<string> Closed = new List<string>();
        public event Action<string, string> Decided;
        public void Open(string id, string path, string original, string proposed, bool isNewFile) => Opened.Add((id, path, original, proposed, isNewFile));
        public void Close(string id) => Closed.Add(id);
        public void Decide(string id, string decision) => Decided?.Invoke(id, decision);
    }

    internal sealed class FakeBuffers : IEditorBuffers
    {
        public readonly List<string> Saved = new List<string>();
        public readonly List<Action> Completions = new List<Action>();
        public void SaveIfDirty(string path, Action done) { Saved.Add(path); Completions.Add(done); }
        public void CompleteAll() { foreach (var c in Completions) c(); }
    }
}
