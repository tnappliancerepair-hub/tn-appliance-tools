// Returns the live website-chat SYSTEM_PROMPT env var so the new
// website-ant-brain Netlify function uses the same prompt the legacy
// chat/reply2 endpoint uses. Single source of truth — Teddy edits
// the prompt in the Xano env, both brain paths pick it up.
query get_website_chat_prompt verb=GET {
  api_group = "intake"

  input {
    int? _unused?
  }

  stack {
    var $prompt { value = (($env.SYSTEM_PROMPT ?? "")|trim) }
  }

  response = {
    success: ($prompt != "")
    prompt: $prompt
    length: ($prompt|strlen)
  }

  guid = "get-website-chat-prompt-v1"
}
