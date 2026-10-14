using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace VSClaudio.Core
{
    public sealed class SidecarProcess : ISidecar
    {
        // .NET Framework has no StandardInputEncoding; stdin defaults to the console code page, which mangles
        // non-ASCII text. Both directions use UTF-8 without a BOM.
        private static readonly Encoding Utf8 = new UTF8Encoding(false);

        private readonly string _exePath;
        private readonly string _arguments;
        private readonly ILog _log;
        private readonly object _writeLock = new object();
        private Process _process;
        private StreamWriter _stdin;

        public SidecarProcess(string exePath, string arguments, ILog log)
        {
            _exePath = exePath;
            _arguments = arguments;
            _log = log;
        }

        public event Action<string> LineReceived;
        public event Action<int> Exited;

        public void Start()
        {
            var psi = new ProcessStartInfo(_exePath, _arguments ?? "")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Utf8,
                StandardErrorEncoding = Utf8,
            };
            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            process.OutputDataReceived += (s, e) => { if (e.Data != null) LineReceived?.Invoke(e.Data); };
            process.ErrorDataReceived += (s, e) => { if (e.Data != null) _log.Info("sidecar: " + e.Data); };
            process.Exited += (s, e) =>
            {
                // The parameterless overload waits until redirected output has been fully read.
                process.WaitForExit();
                Exited?.Invoke(process.ExitCode);
            };

            process.Start();
            if (!JobObject.Shared.Assign(process)) _log.Info("Could not assign the sidecar to a job object.");
            _stdin = new StreamWriter(process.StandardInput.BaseStream, Utf8) { AutoFlush = true, NewLine = "\n" };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            _process = process;
        }

        public void Send(string line)
        {
            lock (_writeLock)
            {
                try
                {
                    _stdin?.WriteLine(line);
                }
                catch (IOException ex)
                {
                    _log.Info("Write to sidecar failed: " + ex.Message);
                }
                catch (ObjectDisposedException)
                {
                }
            }
        }

        public void Stop()
        {
            var process = _process;
            if (process == null) return;
            try
            {
                lock (_writeLock) _stdin?.Close();
                if (!process.WaitForExit(1500)) process.Kill();
            }
            catch (InvalidOperationException)
            {
                // Already exited.
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                _log.Info("Failed to stop the sidecar: " + ex.Message);
            }
        }
    }
}
