using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace VSClaudio.Core.Tests
{
    public class SidecarProcessTests
    {
        private static readonly string PowerShell =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");

        // Encoded so no quoting survives the command line; reads and writes raw UTF-8 like the real sidecar.
        private static SidecarProcess Script(string script, FakeLog log = null) =>
            new SidecarProcess(PowerShell, "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(script)), log ?? new FakeLog());

        private const string Echo =
            "$r = New-Object IO.StreamReader([Console]::OpenStandardInput(), (New-Object Text.UTF8Encoding $false)); " +
            "$w = New-Object IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object Text.UTF8Encoding $false)); $w.AutoFlush = $true; " +
            "while (($l = $r.ReadLine()) -ne $null) { $w.WriteLine($l) }";

        [Fact]
        public void RoundTripsUnicode()
        {
            var p = Script(Echo);
            string got = null;
            var done = new ManualResetEventSlim();
            p.LineReceived += l => { got = l; done.Set(); };
            p.Start();
            p.Send("{\"t\":\"send\",\"text\":\"café ✓ 🚀\"}");
            Assert.True(done.Wait(TimeSpan.FromSeconds(15)), "no echo");
            Assert.Equal("{\"t\":\"send\",\"text\":\"café ✓ 🚀\"}", got);
            p.Stop();
        }

        [Fact]
        public void ReportsExitCode()
        {
            var p = Script("exit 3");
            var code = -1;
            var done = new ManualResetEventSlim();
            p.Exited += c => { code = c; done.Set(); };
            p.Start();
            Assert.True(done.Wait(TimeSpan.FromSeconds(15)), "no exit");
            Assert.Equal(3, code);
        }

        [Fact]
        public void StderrGoesToLog()
        {
            var log = new FakeLog();
            var p = Script("[Console]::Error.WriteLine('boom'); exit 0", log);
            var done = new ManualResetEventSlim();
            p.Exited += _ => done.Set();
            p.Start();
            Assert.True(done.Wait(TimeSpan.FromSeconds(15)));
            Assert.Contains(log.Lines, l => l.Contains("boom"));
        }

        [Fact]
        public void StopKillsAnUnresponsiveProcess()
        {
            var p = Script("Start-Sleep -Seconds 60");
            var exited = new ManualResetEventSlim();
            p.Exited += _ => exited.Set();
            p.Start();
            var sw = Stopwatch.StartNew();
            p.Stop();
            Assert.True(exited.Wait(TimeSpan.FromSeconds(10)), "not killed");
            Assert.True(sw.Elapsed < TimeSpan.FromSeconds(10));
        }

        [Fact]
        public void SendAfterExitDoesNotThrow()
        {
            var p = Script("exit 0");
            var done = new ManualResetEventSlim();
            p.Exited += _ => done.Set();
            p.Start();
            Assert.True(done.Wait(TimeSpan.FromSeconds(15)));
            p.Send("{\"t\":\"interrupt\"}");
        }

        [Fact]
        public void StopUnderAContendedLockDoesNotDeadlock()
        {
            var p = Script("$w = New-Object IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object Text.UTF8Encoding $false)); $w.AutoFlush = $true; for ($i = 0; $i -lt 200000; $i++) { $w.WriteLine($i) }");
            var gate = new object();
            var first = new ManualResetEventSlim();
            p.LineReceived += _ => { first.Set(); lock (gate) { } };
            p.Start();
            Assert.True(first.Wait(TimeSpan.FromSeconds(15)), "no output");
            var stop = Task.Run(() => { lock (gate) { p.Stop(); } });
            Assert.True(stop.Wait(TimeSpan.FromSeconds(15)), "Stop deadlocked");
        }

        [Fact]
        public void JobObjectIsActive() => Assert.True(JobObject.Shared.IsActive);
    }
}
