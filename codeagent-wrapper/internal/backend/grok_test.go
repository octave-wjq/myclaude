package backend

import (
	"reflect"
	"strings"
	"testing"

	"codeagent-wrapper/internal/config"
)

func TestGrokBackend(t *testing.T) {
	if len(Registry()) != 5 {
		t.Fatal("all existing backends must remain registered")
	}
	if fallback, err := Select(""); err != nil || fallback.Name() != "codex" {
		t.Fatal("unconfigured default must remain backward compatible")
	}
	if _, err := Select("nonexistent-backend"); err == nil {
		t.Fatal("unknown backends must fail explicitly")
	}
	b, err := Select(" GROK ")
	if err != nil || b.Name() != "grok" || b.Command() != "grok" {
		t.Fatalf("Grok registration: %v, %v", b, err)
	}
	if b.BuildArgs(nil, "task") != nil {
		t.Fatal("nil config should produce no args")
	}
	if got := b.Env("", ""); !reflect.DeepEqual(got, map[string]string{"CODEAGENT_WORKER": "1"}) {
		t.Fatalf("OAuth environment: %v", got)
	}
	if got := b.Env("", " test-key ")["XAI_API_KEY"]; got != "test-key" {
		t.Fatalf("API key not normalized: %q", got)
	}
	if got := b.Env(" https://example.invalid/v1 ", "")["GROK_MODELS_BASE_URL"]; got != "https://example.invalid/v1" {
		t.Fatalf("Base URL not normalized: %q", got)
	}
}

func TestGrokArgs(t *testing.T) {
	for _, tc := range []struct {
		name   string
		cfg    config.Config
		prompt string
		want   []string
		forbid []string
	}{
		{"defaults", config.Config{}, "do work", []string{"--model grok-4.6", "--reasoning-effort xhigh", "-p do work", "--no-subagents", "--no-plan", "--permission-mode auto", "--output-format streaming-messages-json"}, []string{"--permission-mode bypassPermissions", "--resume", "--prompt-file"}},
		{"stdin", config.Config{WorkDir: "/tmp/path with spaces"}, "-", []string{"--prompt-file /dev/stdin", "--cwd /tmp/path with spaces"}, []string{"-p -"}},
		{"resume", config.Config{Mode: "resume", SessionID: "session-1", Model: " grok-4.5 ", ReasoningEffort: " medium ", SkipPermissions: true, AllowedTools: []string{"read_file", "grep"}, DisallowedTools: []string{"write", "web_search"}}, "follow up", []string{"-r session-1", "--model grok-4.5", "--reasoning-effort medium", "--permission-mode bypassPermissions", "--allow read_file --allow grep", "--deny write --deny web_search"}, nil},
		{"yolo", config.Config{Yolo: true}, "task", []string{"--permission-mode bypassPermissions"}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CODEAGENT_SKIP_PERMISSIONS", "false")
			args := (GrokBackend{}).BuildArgs(&tc.cfg, tc.prompt)
			joined := strings.Join(args, " ")
			for _, want := range tc.want {
				if !strings.Contains(joined, want) {
					t.Errorf("missing %q in %v", want, args)
				}
			}
			for _, forbid := range tc.forbid {
				if strings.Contains(joined, forbid) {
					t.Errorf("unexpected %q in %v", forbid, args)
				}
			}
		})
	}
}
