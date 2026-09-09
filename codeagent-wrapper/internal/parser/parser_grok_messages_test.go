package parser

import (
	"strings"
	"testing"
)

func TestGrokMessagesStream(t *testing.T) {
	// Grok emits whole assistant messages, then a Claude-compatible final result.
	stream := `{"type":"system","subtype":"init","session_id":"grok-session","model":"grok-4.6"}
{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"private"},{"type":"text","text":"interim"}]},"session_id":"grok-session"}
{"type":"result","subtype":"success","is_error":false,"result":"实现完成\nTests passed","session_id":"grok-session"}
`
	completed := 0
	message, session := ParseJSONStreamInternal(strings.NewReader(stream), nil, nil, nil, func() { completed++ })
	if message != "实现完成\nTests passed" || session != "grok-session" || completed != 1 {
		t.Fatalf("message=%q session=%q completed=%d", message, session, completed)
	}
}

func TestGrokExecutionErrorIsNotSuccessfulOutput(t *testing.T) {
	stream := `{"type":"result","subtype":"error_during_execution","is_error":true,"result":"permission denied","errors":["cancelled"],"session_id":"grok-session"}`
	var warnings []string
	completed := 0
	message, session := ParseJSONStreamInternal(strings.NewReader(stream), func(s string) { warnings = append(warnings, s) }, nil, nil, func() { completed++ })
	if message != "" || session != "grok-session" || completed != 1 {
		t.Fatalf("error was not preserved: %q %q %d", message, session, completed)
	}
	if !strings.Contains(strings.Join(warnings, " "), "permission denied cancelled") {
		t.Fatalf("error detail missing: %v", warnings)
	}
}
