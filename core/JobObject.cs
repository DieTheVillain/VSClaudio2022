using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace VSClaudio.Core
{
    /// <summary>
    /// A Windows job object with KILL_ON_JOB_CLOSE. The handle closes when Visual Studio exits, even on a crash,
    /// which kills every process assigned to it, including the sidecar's claude.exe child.
    /// </summary>
    internal sealed class JobObject
    {
        public static readonly JobObject Shared = new JobObject();

        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
        private readonly IntPtr _handle;

        /// <summary>True only when the job exists and its kill-on-close limit was applied.</summary>
        public bool IsActive { get; }

        private JobObject()
        {
            try
            {
                _handle = CreateJobObject(IntPtr.Zero, null);
                if (_handle == IntPtr.Zero) return;
                IsActive = ApplyKillOnClose();
            }
            catch (Exception)
            {
                // Leave IsActive false; the caller logs that the guarantee is unavailable.
            }
        }

        private bool ApplyKillOnClose()
        {
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
            {
                BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION { LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE },
            };
            var length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            var ptr = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(info, ptr, false);
                return SetInformationJobObject(_handle, JobObjectExtendedLimitInformation, ptr, (uint)length);
            }
            finally
            {
                Marshal.FreeHGlobal(ptr);
            }
        }

        public bool Assign(Process process) => IsActive && AssignProcessToJobObject(_handle, process.Handle);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll")]
        private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }
    }
}
