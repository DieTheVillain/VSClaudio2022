using System;

namespace VSClaudio.Core
{
    public interface ISidecar
    {
        event Action<string> LineReceived;
        event Action<int> Exited;
        void Start();
        void Send(string line);
        void Stop();
    }

    /// <summary>Posts a JSON message to the webview. Implementations marshal to the UI thread.</summary>
    public interface IWebviewPoster
    {
        void Post(string json);
    }

    public interface ILog
    {
        void Info(string message);
    }
}
