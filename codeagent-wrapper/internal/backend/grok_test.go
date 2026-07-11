package backend

import (
	"reflect"
	"testing"

	config "codeagent-wrapper/internal/config"
)

func TestGrokBackend_Basics(t *testing.T) {
	b := GrokBackend{}
	if b.Name() != "grok" {
		t.Fatalf("Name = %q, want grok", b.Name())
	}
	if b.Command() != "grok" {
		t.Fatalf("Command = %q, want grok", b.Command())
	}
}

func TestGrokBackend_Env(t *testing.T) {
	b := GrokBackend{}
	if got := b.Env("", ""); got != nil {
		t.Fatalf("Env(empty) = %v, want nil", got)
	}
	got := b.Env(" https://api.x.ai ", " key-123 ")
	want := map[string]string{"XAI_BASE_URL": "https://api.x.ai", "XAI_API_KEY": "key-123"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Env = %v, want %v", got, want)
	}
	if got := b.Env("https://api.x.ai", ""); !reflect.DeepEqual(got, map[string]string{"XAI_BASE_URL": "https://api.x.ai"}) {
		t.Fatalf("Env(baseURL only) = %v", got)
	}
}

func TestGrokBuildArgs(t *testing.T) {
	b := GrokBackend{}

	t.Run("new mode default skip-permissions", func(t *testing.T) {
		cfg := &config.Config{Mode: "new", Model: "grok-4", WorkDir: "/repo"}
		got := b.BuildArgs(cfg, "do it")
		want := []string{
			"--output-format", "streaming-json",
			"--permission-mode", "bypassPermissions",
			"-m", "grok-4",
			"-p", "do it",
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("skip-permissions disabled via env, stdin, effort, tools", func(t *testing.T) {
		t.Setenv("CODEAGENT_SKIP_PERMISSIONS", "false")
		cfg := &config.Config{
			Mode:            "new",
			ReasoningEffort: "high",
			AllowedTools:    []string{"Edit"},
			DisallowedTools: []string{"Bash"},
		}
		got := b.BuildArgs(cfg, "-")
		want := []string{
			"--output-format", "streaming-json",
			"--reasoning-effort", "high",
			"--allow", "Edit",
			"--deny", "Bash",
			"--prompt-file", "/dev/stdin",
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("stdin mode uses prompt-file, not literal dash", func(t *testing.T) {
		cfg := &config.Config{Mode: "new"}
		got := b.BuildArgs(cfg, "-")
		want := []string{
			"--output-format", "streaming-json",
			"--permission-mode", "bypassPermissions",
			"--prompt-file", "/dev/stdin",
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode includes session id", func(t *testing.T) {
		t.Setenv("CODEAGENT_SKIP_PERMISSIONS", "false")
		cfg := &config.Config{Mode: "resume", SessionID: "sid-9"}
		got := b.BuildArgs(cfg, "again")
		want := []string{
			"--output-format", "streaming-json",
			"-r", "sid-9",
			"-p", "again",
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("nil config", func(t *testing.T) {
		if got := b.BuildArgs(nil, "x"); got != nil {
			t.Fatalf("BuildArgs(nil) = %v, want nil", got)
		}
	})
}
