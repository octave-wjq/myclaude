package parser

import (
	"strings"
	"testing"
)

func TestParseJSONStream_Grok(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"thought","data":"thinking"}`,
		`{"type":"text","data":"Hello"}`,
		`{"type":"text","data":", world"}`,
		`{"type":"end","stopReason":"EndTurn","sessionId":"sess-abc"}`,
	}, "\n")

	msg, threadID := ParseJSONStreamInternal(strings.NewReader(input), nil, nil, nil, nil)

	if msg != "Hello, world" {
		t.Fatalf("message = %q, want %q", msg, "Hello, world")
	}
	if threadID != "sess-abc" {
		t.Fatalf("threadID = %q, want %q", threadID, "sess-abc")
	}
}

func TestParseJSONStream_GrokIgnoresThoughtOnly(t *testing.T) {
	input := `{"type":"thought","data":"just reasoning"}` + "\n" +
		`{"type":"end","stopReason":"EndTurn","sessionId":"s1"}`

	msg, threadID := ParseJSONStreamInternal(strings.NewReader(input), nil, nil, nil, nil)
	if msg != "" {
		t.Fatalf("message = %q, want empty", msg)
	}
	if threadID != "s1" {
		t.Fatalf("threadID = %q, want s1", threadID)
	}
}
