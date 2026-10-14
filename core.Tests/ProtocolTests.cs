using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using Xunit;

namespace VSClaudio.Core.Tests
{
    public class ProtocolTests
    {
        private static readonly JObject S = Fixtures.Samples();
        private static IEnumerable<JObject> List(string name) => ((JArray)S[name]).Cast<JObject>();
        private static HashSet<string> Kinds(string name) => new HashSet<string>(List(name).Select(o => (string)o["t"]));

        [Fact] public void VersionMatchesTypeScript() => Assert.Equal(Protocol.Version, (int)S["protocolVersion"]);

        [Fact] public void KnowsEveryHostCommand() => Assert.Equal(Kinds("hostCommands"), new HashSet<string>(Protocol.HostCommandTypes));
        [Fact] public void KnowsEverySidecarEvent() => Assert.Equal(Kinds("sidecarEvents"), new HashSet<string>(Protocol.SidecarEventTypes));
        [Fact] public void KnowsEveryHostOnlyMessage() => Assert.Equal(Kinds("hostToWebview"), new HashSet<string>(Protocol.HostOnlyWebviewTypes));
        [Fact] public void KnowsEveryWebviewCommand() => Assert.Equal(Kinds("webviewCommands"), new HashSet<string>(Protocol.WebviewCommandTypes));

        [Fact]
        public void BuildersReproduceHostCommandSamples()
        {
            foreach (var sample in List("hostCommands"))
            {
                string built;
                switch ((string)sample["t"])
                {
                    case "hello": built = Protocol.Hello((string)sample["cwd"], (string)sample["claudePath"], (string)sample["resume"]); break;
                    case "send": built = Protocol.Send((string)sample["text"]); break;
                    default: built = Protocol.Simple((string)sample["t"]); break;
                }
                Assert.True(JToken.DeepEquals(sample, JObject.Parse(built)), $"expected {sample.ToString(Newtonsoft.Json.Formatting.None)} got {built}");
            }
        }

        [Fact]
        public void BuildersReproduceHostOnlySamples()
        {
            foreach (var sample in List("hostToWebview"))
            {
                string built = (string)sample["t"] == "status"
                    ? Protocol.Status((string)sample["state"], (string)sample["detail"])
                    : Protocol.Theme(((JObject)sample["vars"]).Properties().ToDictionary(p => p.Name, p => (string)p.Value));
                Assert.True(JToken.DeepEquals(sample, JObject.Parse(built)), $"expected {sample.ToString(Newtonsoft.Json.Formatting.None)} got {built}");
            }
        }

        [Fact]
        public void TurnEndBuilderMatchesSidecarShape()
        {
            var built = JObject.Parse(Protocol.TurnEnd("interrupted", "Session disconnected"));
            Assert.Equal("turn_end", (string)built["t"]);
            Assert.Equal("interrupted", (string)built["status"]);
            Assert.Equal("Session disconnected", (string)built["error"]);
        }

        [Fact]
        public void BuildersAreSingleLine() => Assert.DoesNotContain("\n", Protocol.Send("a\nb"));

        [Fact]
        public void TryParseRejectsGarbage()
        {
            Assert.Null(Protocol.TryParse("not json"));
            Assert.Equal("ready", Protocol.TypeOf(Protocol.TryParse("{\"t\":\"ready\",\"protocol\":1}")));
        }
    }
}
