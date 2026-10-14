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

    public interface ILog
    {
        /// <summary>Must return immediately; never marshal synchronously to the UI thread (called under the bridge's lock from background threads).</summary>
        void Info(string message);
    }
}
