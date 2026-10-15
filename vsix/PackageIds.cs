using System;
using Microsoft.VisualStudio.Imaging.Interop;

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

    // Must match Resources\VSClaudio.imagemanifest and the guidVSClaudioImages symbol in the .vsct.
    internal static class ImageIds
    {
        public static readonly Guid Images = new Guid("363b2603-59d2-4284-9436-78c96fda961b");
        public const int ChatIcon = 1;
        public static ImageMoniker Chat => new ImageMoniker { Guid = Images, Id = ChatIcon };
    }
}
