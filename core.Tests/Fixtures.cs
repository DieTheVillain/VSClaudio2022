using System;
using System.IO;
using Newtonsoft.Json.Linq;

namespace VSClaudio.Core.Tests
{
    internal static class Fixtures
    {
        public static JObject Samples()
        {
            var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "protocol", "fixtures", "samples.json");
                if (File.Exists(candidate)) return JObject.Parse(File.ReadAllText(candidate));
                dir = dir.Parent;
            }
            throw new FileNotFoundException("protocol/fixtures/samples.json not found above " + AppDomain.CurrentDomain.BaseDirectory);
        }
    }
}
