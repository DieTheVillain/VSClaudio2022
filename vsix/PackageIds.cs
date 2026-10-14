using System;

namespace VSClaudio
{
    // Must match the GuidSymbol/IDSymbol values in VSCommandTable.vsct.
    internal static class PackageGuids
    {
        public const string PackageString = "e3b7a2c4-6f1d-4a58-9b0e-2c7d5f8a1b36";
        public const string CmdSetString = "9a4c1e7b-3d2f-4b86-a5c0-7e1f2d3b4c59";
        public static readonly Guid CmdSet = new Guid(CmdSetString);
    }

    internal static class PackageIds
    {
        public const int OpenChat = 0x0100;
    }
}
