using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace VSClaudio.Core
{
    /// <summary>
    /// Host-side view of the protocol defined in protocol/src/index.ts. Sidecar events are forwarded
    /// to the webview as the original line, so only messages the host builds or inspects live here.
    /// </summary>
    public static class Protocol
    {
        public const int Version = 2;

        public static readonly string[] HostCommandTypes = { "hello", "send", "interrupt", "new_session", "shutdown", "permission_response", "set_mode", "edit_prepared" };
        public static readonly string[] SidecarEventTypes = { "ready", "session", "block_start", "block_delta", "tool_input", "tool_result", "turn_end", "error", "permission_request", "permission_resolved", "mode", "notice", "prepare_edit" };
        public static readonly string[] HostOnlyWebviewTypes = { "status", "theme" };
        public static readonly string[] WebviewCommandTypes = { "webview_ready", "send", "interrupt", "new_session", "reconnect", "choose_folder", "permission_response", "set_mode", "open_diff" };

        public static JObject TryParse(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            try { return JObject.Parse(json); }
            catch (JsonException) { return null; }
        }

        public static string TypeOf(JObject message) => (string)message?["t"];

        public static string Hello(string cwd, string claudePath = null, string resume = null)
        {
            var o = new JObject { ["t"] = "hello", ["protocol"] = Version, ["cwd"] = cwd };
            if (claudePath != null) o["claudePath"] = claudePath;
            if (resume != null) o["resume"] = resume;
            return Serialize(o);
        }

        public static string Send(string text) => Serialize(new JObject { ["t"] = "send", ["text"] = text });

        public static string Simple(string type) => Serialize(new JObject { ["t"] = type });

        public static string Status(string state, string detail = null)
        {
            var o = new JObject { ["t"] = "status", ["state"] = state };
            if (detail != null) o["detail"] = detail;
            return Serialize(o);
        }

        public static string Theme(IDictionary<string, string> vars)
        {
            var v = new JObject();
            foreach (var kv in vars) v[kv.Key] = kv.Value;
            return Serialize(new JObject { ["t"] = "theme", ["vars"] = v });
        }

        public static string TurnEnd(string status, string error = null)
        {
            var o = new JObject { ["t"] = "turn_end", ["status"] = status };
            if (error != null) o["error"] = error;
            return Serialize(o);
        }

        public static string PermissionResponse(string id, string decision, string message = null)
        {
            var o = new JObject { ["t"] = "permission_response", ["id"] = id, ["decision"] = decision };
            if (message != null) o["message"] = message;
            return Serialize(o);
        }

        public static string PermissionResolved(string id, string outcome) =>
            Serialize(new JObject { ["t"] = "permission_resolved", ["id"] = id, ["outcome"] = outcome });

        public static string EditPrepared(string id) => Serialize(new JObject { ["t"] = "edit_prepared", ["id"] = id });

        private static string Serialize(JObject o) => o.ToString(Formatting.None);
    }
}
