using System.IO;
using Xunit;

namespace VSClaudio.Core.Tests
{
    public class DiffPathsTests
    {
        private static readonly string Root = Path.Combine(Path.GetTempPath(), "VSClaudioTests", "diffs");

        private static void AssertStrictlyUnderRoot(string folder)
        {
            Assert.True(DiffPaths.IsStrictlyUnder(Root, folder), folder);
            Assert.StartsWith(Path.GetFullPath(Root) + Path.DirectorySeparatorChar, folder);
        }

        [Fact] public void NormalIdIsAChildOfRoot() => Assert.Equal(Path.Combine(Path.GetFullPath(Root), "toolu_01AbC"), DiffPaths.FolderFor(Root, "toolu_01AbC"));

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData("\t")]
        [InlineData(null)]
        public void EmptyOrWhitespaceIdFallsBackToUnderscore(string id) => Assert.Equal(Path.Combine(Path.GetFullPath(Root), "_"), DiffPaths.FolderFor(Root, id));

        [Theory]
        [InlineData("..")]
        [InlineData(".. ")]
        [InlineData(".")]
        [InlineData(" . . ")]
        [InlineData(@"..\..\x")]
        [InlineData("../../x")]
        [InlineData(@"C:\Windows")]
        public void TraversalIdsStayUnderRoot(string id) => AssertStrictlyUnderRoot(DiffPaths.FolderFor(Root, id));

        [Fact]
        public void TrailingSpaceAndDotIdsDoNotEscapeAndMayCollide()
        {
            // "x. " trims to "x": the two ids share a folder. A collision is acceptable; escaping the root is not.
            var a = DiffPaths.FolderFor(Root, "x. ");
            var b = DiffPaths.FolderFor(Root, "x");
            AssertStrictlyUnderRoot(a);
            AssertStrictlyUnderRoot(b);
            Assert.Equal(b, a);
        }

        [Fact]
        public void InvalidFileNameCharsAreReplaced()
        {
            var folder = DiffPaths.FolderFor(Root, "a:b*c?d<e>f|g\"h");
            AssertStrictlyUnderRoot(folder);
            Assert.Equal("a_b_c_d_e_f_g_h", Path.GetFileName(folder));
        }

        [Fact] public void RootItselfIsNotStrictlyUnder() => Assert.False(DiffPaths.IsStrictlyUnder(Root, Root));

        [Fact] public void RootWithTrailingSeparatorIsNotStrictlyUnder() => Assert.False(DiffPaths.IsStrictlyUnder(Root, Root + Path.DirectorySeparatorChar));

        [Fact] public void SiblingSharingAPrefixIsNotStrictlyUnder() => Assert.False(DiffPaths.IsStrictlyUnder(Root, Root + "2"));

        [Fact] public void ParentIsNotStrictlyUnder() => Assert.False(DiffPaths.IsStrictlyUnder(Root, Path.Combine(Root, "..")));

        [Fact] public void ChildIsStrictlyUnderCaseInsensitively() => Assert.True(DiffPaths.IsStrictlyUnder(Root, Path.Combine(Root.ToUpperInvariant(), "abc")));
    }
}
