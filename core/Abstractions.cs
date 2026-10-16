using System;

namespace VSClaudio.Core
{
    public interface ISidecar
    {
        event Action<string> LineReceived;
        event Action<int> Exited;
        void Start();
        /// <summary>Writes one line; must not wait on other threads (called under the bridge's lock).</summary>
        void Send(string line);
        void Stop();
    }

    /// <summary>
    /// Posts a JSON message to the webview. Must not block; implementations queue and marshal to the UI thread asynchronously.
    /// </summary>
    public interface IWebviewPoster
    {
        void Post(string json);
    }

    /// <summary>
    /// Shows a proposed file edit for review (the VS diff tab). Called under the bridge's lock, so implementations must not block
    /// or marshal synchronously to another thread; marshal to the UI thread asynchronously.
    /// </summary>
    public interface IEditReviewer
    {
        void Open(string id, string path, string original, string proposed, bool isNewFile);
        void Close(string id);
        /// <summary>Raised with (id, "allow" | "deny") when the user decides in the review UI; may be raised on any thread.</summary>
        event Action<string, string> Decided;
    }

    /// <summary>
    /// Access to open editor buffers. Called under the bridge's lock only to start work: must not block; invoke
    /// <c>done</c> on any thread when finished, including on failure.
    /// </summary>
    public interface IEditorBuffers
    {
        void SaveIfDirty(string path, Action done);
    }

    public interface ILog
    {
        /// <summary>Must return immediately; never marshal synchronously to the UI thread (called under the bridge's lock from background threads).</summary>
        void Info(string message);
    }
}
